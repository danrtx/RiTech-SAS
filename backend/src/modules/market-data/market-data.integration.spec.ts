import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { firstValueFrom, filter, timeout } from 'rxjs';
import { WebSocket } from 'ws';
import { performance } from 'node:perf_hooks';
import { RedisCacheModule } from '../redis-cache/redis-cache.module';
import { RedisCacheService } from '../redis-cache/redis-cache.service';
import { MarketDataModule } from './market-data.module';
import { parseMarketDataConfig } from './market-data.config';
import { MarketDataWsClient } from './market-data-ws.client';
import { MarketDataProcessor } from './market-data.processor';
import { AlpacaMockServer } from './testing/alpaca-mock.server';
import { createTradeFixture } from './testing/alpaca.fixtures';
import { TEST_TIME_MS as BASE } from './testing/market-tick.fixture';

/** Cliente mínimo del transporte Socket.IO/Engine.IO, para probar el evento real sin dependencias nuevas. */
function dashboard(socket: WebSocket) {
  const backlog: string[] = [];
  const waiters: {
    predicate: (line: string) => boolean;
    resolve: (line: string) => void;
  }[] = [];
  socket.on('error', () => undefined);
  socket.on('message', (data) => {
    const line = data.toString();
    if (line === '2') {
      socket.send('3');
      return;
    }
    const index = waiters.findIndex((waiter) => waiter.predicate(line));
    if (index < 0) backlog.push(line);
    else waiters.splice(index, 1)[0].resolve(line);
  });
  return (predicate: (line: string) => boolean) => {
    const index = backlog.findIndex(predicate);
    if (index >= 0) return Promise.resolve(backlog.splice(index, 1)[0]);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error('Timeout de evento dashboard'));
      }, 2000);
      const waiter = {
        predicate,
        resolve: (line: string) => {
          clearTimeout(timer);
          resolve(line);
        },
      };
      waiters.push(waiter);
    });
  };
}

describe('Mock → backend → historial/reglas HTTP → alerta Socket.IO', () => {
  it('emite una alerta real al dashboard al cruzar el umbral y reinicia el historial ante un corte', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const mock = new AlpacaMockServer();
    const url = await mock.start();
    const redis = { setTick: jest.fn(), pushATRWindow: jest.fn() };
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              marketData: parseMarketDataConfig({
                MARKET_DATA_ENABLED: 'true',
                MARKET_DATA_FEED: 'mock',
                MARKET_DATA_WS_URL: url,
              }),
            }),
          ],
        }),
        RedisCacheModule,
        MarketDataModule,
      ],
    })
      .overrideProvider(RedisCacheService)
      .useValue(redis)
      .compile();
    const app = module.createNestApplication();
    let socket: WebSocket | undefined;
    try {
      await app.listen(0, '127.0.0.1');
      const http = await app.getUrl();
      const put = await fetch(`${http}/market-data/rules/qqq-1s`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          windowMs: 1000,
          upPercent: 4,
          downPercent: 4,
          thresholdBasis: 'INVESTMENT',
          investedAmount: 10000,
          cooldownMs: 0,
        }),
      });
      expect(put.status).toBe(200);
      expect(await put.json()).toMatchObject({ id: 'qqq-1s', enabled: true });
      const invalid = await fetch(`${http}/market-data/rules/invalid`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          windowMs: '1000',
          upPercent: 0,
          downPercent: 1,
          secret: 'sentinel-secret',
        }),
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.text()).not.toContain('sentinel-secret');
      expect(
        (await fetch(`${http}/market-data/history?limit=1001`)).status,
      ).toBe(400);

      socket = new WebSocket(
        `${http.replace('http:', 'ws:')}/socket.io/?EIO=4&transport=websocket`,
      );
      const frame = dashboard(socket);
      await frame((line) => line.startsWith('0'));
      socket.send('40/telemetry,');
      await frame((line) => line.startsWith('40/telemetry,'));
      socket.send('42/telemetry,["subscribe_symbol",{"symbol":"QQQ"}]');
      await frame(
        (line) =>
          line.startsWith('42/telemetry,') && line.includes('"subscribed"'),
      );

      jest.spyOn(Date, 'now').mockReturnValue(BASE);
      mock.publish([
        createTradeFixture({ i: 1, p: 100, t: new Date(BASE).toISOString() }),
      ]);
      const first = await frame((line) => line.includes('"telemetry_tick"'));
      expect(JSON.parse(first.slice('42/telemetry,'.length))[1]).toMatchObject({
        eventTimeMs: BASE,
        timestamp: new Date(BASE).toISOString(),
        price: 100,
      });
      expect(
        await (await fetch(`${http}/market-data/rules`)).json(),
      ).toMatchObject([{ id: 'qqq-1s', analysis: { status: 'WARMING_UP' } }]);

      jest.spyOn(Date, 'now').mockReturnValue(BASE + 1000);
      const startedAt = performance.now();
      mock.publish([
        createTradeFixture({
          i: 2,
          p: 102,
          t: new Date(BASE + 1000).toISOString(),
        }),
      ]);
      const emitted = await frame((line) => line.includes('"price_alert"'));
      const alert = JSON.parse(emitted.slice('42/telemetry,'.length))[1];
      expect(performance.now() - startedAt).toBeLessThan(200);
      expect(alert).toMatchObject({
        ruleId: 'qqq-1s',
        direction: 'up',
        changePercent: 2,
        evaluatedChangePercent: 4,
        thresholdBasis: 'INVESTMENT',
        investment: {
          leverage: 2,
          changePercent: 4,
          estimatedPnL: 400,
          estimatedValue: 10400,
        },
        decision: { signal: 'REVIEW_GAIN' },
        referenceTimeMs: BASE,
        eventTimeMs: BASE + 1000,
        simulated: true,
      });
      const updateFrame = await frame(
        (line) =>
          line.includes('"investment_update"') && line.includes('"READY"'),
      );
      expect(
        JSON.parse(updateFrame.slice('42/telemetry,'.length))[1],
      ).toMatchObject({
        ruleId: 'qqq-1s',
        status: 'READY',
        investment: { changePercent: 4 },
        decision: { signal: 'REVIEW_GAIN' },
      });

      jest.spyOn(Date, 'now').mockReturnValue(BASE + 1100);
      mock.publish([
        createTradeFixture({
          i: 3,
          p: 98,
          t: new Date(BASE + 1100).toISOString(),
        }),
      ]);
      const lossFrame = await frame((line) => line.includes('"price_alert"'));
      expect(
        JSON.parse(lossFrame.slice('42/telemetry,'.length))[1],
      ).toMatchObject({
        direction: 'down',
        changePercent: -2,
        evaluatedChangePercent: -4,
        investment: { estimatedPnL: -400, estimatedValue: 9600 },
        decision: { signal: 'REVIEW_RISK' },
      });
      await app.get(MarketDataProcessor).whenIdle();
      const status = await (await fetch(`${http}/market-data/status`)).json();
      expect(status).toMatchObject({
        connection: { state: 'LIVE' },
        ingestion: { delivered: 3, receiptToConsumerLatencyMs: { count: 3 } },
        analysis: {
          points: 3,
          alertsEmitted: 2,
          rules: [{ analysis: { status: 'READY' } }],
        },
      });
      expect(status.ingestion.receiptToConsumerLatencyMs.max).toBeLessThan(200);
      expect(
        await (await fetch(`${http}/market-data/history?limit=1`)).json(),
      ).toMatchObject({
        points: 3,
        samples: [{ eventTimeMs: BASE + 1100, price: 98 }],
      });
      expect(redis.setTick).not.toHaveBeenCalled();

      const degraded = firstValueFrom(
        app.get(MarketDataWsClient).status$.pipe(
          filter((status) => status.state === 'DEGRADED'),
          timeout(2000),
        ),
      );
      const recovered = firstValueFrom(
        app.get(MarketDataWsClient).status$.pipe(
          filter((status) => status.state === 'LIVE'),
          timeout(2000),
        ),
      );
      const disconnectedAt = performance.now();
      mock.disconnectClients();
      await degraded;
      const quality = await frame((line) =>
        line.includes('"market_data_quality"'),
      );
      expect(quality).toContain('connection_unavailable');
      expect(
        await (await fetch(`${http}/market-data/history`)).json(),
      ).toMatchObject({ points: 0, samples: [] });
      await recovered;
      expect(performance.now() - disconnectedAt).toBeLessThan(2000);
      expect(
        await (await fetch(`${http}/market-data/status`)).json(),
      ).toMatchObject({
        connection: { state: 'LIVE' },
        recovery: { reconnects: 1 },
      });
      jest.spyOn(Date, 'now').mockReturnValue(BASE + 2000);
      mock.publish([
        createTradeFixture({
          i: 4,
          p: 100,
          t: new Date(BASE + 2000).toISOString(),
        }),
      ]);
      await frame(
        (line) =>
          line.includes('"telemetry_tick"') &&
          line.includes(`"eventTimeMs":${BASE + 2000}`),
      );
      await app.get(MarketDataProcessor).whenIdle();
      expect(
        await (await fetch(`${http}/market-data/rules`)).json(),
      ).toMatchObject([{ analysis: { status: 'WARMING_UP' } }]);
      expect(
        (await fetch(`${http}/market-data/rules/qqq-1s`, { method: 'DELETE' }))
          .status,
      ).toBe(200);
      expect(await (await fetch(`${http}/market-data/rules`)).json()).toEqual(
        [],
      );
    } finally {
      socket?.terminate();
      await app.close();
      await mock.stop();
      jest.restoreAllMocks();
    }
  });
});
