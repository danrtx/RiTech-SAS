import { Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { AlpacaAdapter } from './adapters/alpaca.adapter';
import { parseMarketDataConfig } from './market-data.config';
import { MarketDataProcessor } from './market-data.processor';
import {
  TickConsumer,
  TickDeliveryContext,
  StaleTickDeliveryError,
} from './ports/tick-consumer.interface';
import { MarketTick } from './dto/market-tick.dto';
import { AlpacaDataBatch, AlpacaDataMessage } from './alpaca.protocol';
import { createTradeFixture } from './testing/alpaca.fixtures';
import { TEST_TIME_MS as BASE } from './testing/market-tick.fixture';

describe('Procesador de ticks con cola acotada', () => {
  let consumer: { consume: jest.Mock; invalidate: jest.Mock };
  let processor: MarketDataProcessor;
  let logs: string[];

  beforeEach(() => {
    logs = [];
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((message: unknown) => {
        logs.push(String(message));
      });
    jest.spyOn(Date, 'now').mockReturnValue(BASE);
    consumer = {
      consume: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn(),
    };
    processor = build();
  });
  afterEach(() => jest.restoreAllMocks());

  function build(
    env: Record<string, string> = {},
    override?: TickConsumer,
  ): MarketDataProcessor {
    const config = parseMarketDataConfig({ MARKET_DATA_FEED: 'mock', ...env });
    const instance = new MarketDataProcessor(
      config,
      new AlpacaAdapter(config),
      override ?? consumer,
    );
    instance.setLive(true);
    return instance;
  }

  function trade(
    id: number,
    overrides: Record<string, unknown> = {},
  ): AlpacaDataMessage {
    return {
      ...createTradeFixture({ i: id, p: 100, t: new Date(BASE).toISOString() }),
      ...overrides,
    };
  }

  function batch(...messages: AlpacaDataMessage[]): AlpacaDataBatch {
    return { messages, receivedAtMs: BASE, receivedAtMonotonicMs: 0 };
  }

  it('entrega todos los ticks elegibles en orden y conserva IDs con igual precio y timestamp', async () => {
    processor.accept(
      batch(
        trade(1),
        trade(2),
        trade(1),
        trade(3, { p: -1 }),
        trade(4, { S: 'NDX' }),
      ),
    );
    await processor.whenIdle();
    expect(consumer.consume.mock.calls.map(([tick]) => tick.eventId)).toEqual([
      '1',
      '2',
    ]);
    expect(processor.getStatus()).toMatchObject({
      delivered: 2,
      duplicates: 1,
      rejected: { price: 1, symbol: 1 },
    });
  });

  it('mide la entrega con reloj monotónico y solo cuenta ticks aceptados', async () => {
    const before = processor.getStatus();
    expect(before.receiptToConsumerLatencyMs).toMatchObject({
      count: 0,
      average: null,
      p95: null,
    });
    consumer.consume.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    });
    processor.accept({
      ...batch(trade(1)),
      receivedAtMonotonicMs: performance.now(),
    });
    await processor.whenIdle();
    const metrics = processor.getStatus().receiptToConsumerLatencyMs;
    expect(metrics.count).toBe(1);
    expect(metrics.last).toBeGreaterThanOrEqual(5);
    expect(metrics.p95).toBe(metrics.last);
    expect(metrics.max).toBe(metrics.last);
    consumer.consume.mockRejectedValueOnce(new Error('safe_test_error'));
    processor.accept({
      ...batch(trade(2)),
      receivedAtMonotonicMs: performance.now(),
    });
    await processor.whenIdle();
    expect(processor.getStatus().receiptToConsumerLatencyMs.count).toBe(1);
  });

  it('identifica desorden dentro del mismo milisegundo sin retroceder el precio', async () => {
    const prefix = new Date(BASE).toISOString().slice(0, 19);
    processor.accept(
      batch(
        trade(1, { t: `${prefix}.000000002Z` }),
        trade(2, { t: `${prefix}.000000001Z` }),
      ),
    );
    await processor.whenIdle();
    expect(consumer.consume).toHaveBeenCalledTimes(1);
    expect(processor.getStatus().outOfOrder).toBe(1);
  });

  it('mantiene acotada la memoria de deduplicación y separa las bolsas', async () => {
    processor = build({ MARKET_DATA_DEDUP_CAPACITY: '2' });
    processor.accept(batch(trade(1), trade(2), trade(3), trade(3, { x: 'D' })));
    await processor.whenIdle();
    expect(consumer.consume).toHaveBeenCalledTimes(4);
    expect(processor.getStatus().dedupEntries).toBe(2);
  });

  it('no entrega correcciones ni cancelaciones como operaciones y limpia datos anteriores', async () => {
    processor.accept(batch(trade(1)));
    await processor.whenIdle();
    processor.accept(
      batch({ T: 'c', S: 'QQQ', oi: 1 }, { T: 'x', S: 'QQQ', i: 1 }),
    );
    expect(consumer.consume).toHaveBeenCalledTimes(1);
    expect(consumer.invalidate.mock.calls.map(([reason]) => reason)).toEqual([
      'correction',
      'cancellation',
    ]);
    expect(processor.getStatus().controls).toBe(2);
  });

  it('evita llamadas concurrentes al consumidor', async () => {
    let release!: () => void;
    consumer.consume.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    processor.accept(batch(trade(1), trade(2)));
    await Promise.resolve();
    expect(consumer.consume).toHaveBeenCalledTimes(1);
    expect(processor.getStatus().queueDepth).toBe(1);
    release();
    await processor.whenIdle();
    expect(consumer.consume).toHaveBeenCalledTimes(2);
  });

  it('invalida el historial al desbordar la cola y aborta la entrega activa', async () => {
    let release!: () => void;
    let signal!: AbortSignal;
    consumer.consume.mockImplementationOnce(
      (_tick: MarketTick, context: TickDeliveryContext) => {
        signal = context.signal;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    );
    processor = build({ MARKET_DATA_QUEUE_CAPACITY: '1' });
    processor.accept(batch(trade(1)));
    await Promise.resolve();
    processor.accept(batch(trade(2), trade(3)));
    await processor.whenIdle();
    expect(signal.aborted).toBe(true);
    expect(consumer.invalidate).toHaveBeenCalledWith('queue_overflow');
    expect(processor.getStatus()).toMatchObject({
      dropped: 3,
      queueDepth: 0,
      processing: 'BLOCKED',
    });
    release();
  });

  it('bloquea nuevas entregas tras timeout hasta que el trabajo anterior termina', async () => {
    let release!: () => void;
    let signal!: AbortSignal;
    consumer.consume.mockImplementationOnce(
      (_tick: MarketTick, context: TickDeliveryContext) => {
        signal = context.signal;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    );
    processor = build({ MARKET_DATA_CONSUMER_TIMEOUT_MS: '20' });
    processor.accept(batch(trade(1), trade(2)));
    await processor.whenIdle();
    expect(signal.aborted).toBe(true);
    expect(consumer.invalidate).toHaveBeenCalledWith('consumer_timeout');
    processor.accept(batch(trade(3)));
    expect(consumer.consume).toHaveBeenCalledTimes(1);
    expect(processor.getStatus().processing).toBe('BLOCKED');
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    processor.accept(batch(trade(4)));
    await processor.whenIdle();
    expect(consumer.consume).toHaveBeenCalledTimes(2);
    expect(processor.getStatus()).toMatchObject({
      delivered: 1,
      consumerErrors: 1,
    });
  });

  it('maneja rechazos sin exponer errores originales y descarta el backlog', async () => {
    consumer.consume.mockRejectedValueOnce(new Error('sentinel-secret'));
    processor.accept(batch(trade(1), trade(2)));
    await processor.whenIdle();
    expect(consumer.invalidate).toHaveBeenCalledWith('consumer_error');
    expect(consumer.consume).toHaveBeenCalledTimes(1);
    expect(
      logs.join('\n') + JSON.stringify(processor.getStatus()),
    ).not.toContain('sentinel-secret');
  });

  it('vuelve a comprobar frescura después de esperar en cola', async () => {
    let release!: () => void;
    consumer.consume.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    processor.accept(batch(trade(1), trade(2)));
    await Promise.resolve();
    jest.spyOn(Date, 'now').mockReturnValue(BASE + 1001);
    release();
    await processor.whenIdle();
    expect(consumer.consume).toHaveBeenCalledTimes(1);
    expect(consumer.invalidate).toHaveBeenCalledWith('stale_delivery');
  });

  it('no cuenta como entregado un tick que el consumidor rechaza por frescura', async () => {
    consumer.consume.mockRejectedValueOnce(new StaleTickDeliveryError());
    processor.accept(batch(trade(1)));
    await processor.whenIdle();
    expect(processor.getStatus()).toMatchObject({
      delivered: 0,
      consumerErrors: 0,
      dropped: 1,
      rejected: { stale_delivery: 1 },
    });
    expect(consumer.invalidate).toHaveBeenCalledWith('stale_delivery');
  });

  it('una desconexión cancela el backlog y no acepta datos mientras el feed no esté LIVE', async () => {
    processor.accept(batch(trade(1), trade(2)));
    processor.setLive(false);
    await processor.whenIdle();
    processor.accept(batch(trade(3)));
    expect(consumer.consume).not.toHaveBeenCalled();
    expect(consumer.invalidate).toHaveBeenCalledWith('connection_unavailable');
    expect(processor.getStatus().delivered).toBe(0);
  });

  it('bloquea el análisis si el consumidor no puede invalidar su estado y oculta la excepción', async () => {
    consumer.invalidate.mockImplementationOnce(() => {
      throw new Error('sentinel-secret');
    });
    processor.invalidate('correction');
    processor.accept(batch(trade(1)));
    await processor.whenIdle();
    expect(consumer.consume).not.toHaveBeenCalled();
    expect(processor.getStatus().processing).toBe('BLOCKED');
    expect(logs.join('\n')).not.toContain('sentinel-secret');
    processor.invalidate('correction');
    processor.accept(batch(trade(2)));
    await processor.whenIdle();
    expect(consumer.consume).toHaveBeenCalledTimes(1);
  });
});
