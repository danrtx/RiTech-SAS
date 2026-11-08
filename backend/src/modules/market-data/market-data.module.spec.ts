import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { RedisCacheModule } from '../redis-cache/redis-cache.module';
import { RedisCacheService } from '../redis-cache/redis-cache.service';
import {
  MARKET_DATA_CONFIG,
  MarketDataConfig,
  parseMarketDataConfig,
} from './market-data.config';
import { MarketDataModule } from './market-data.module';
import { MarketDataWsClient } from './market-data-ws.client';
import { AlpacaMockServer } from './testing/alpaca-mock.server';
import { Logger } from '@nestjs/common';

describe('Arranque de MarketDataModule', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  it('resuelve la configuración deshabilitada sin conectar al proveedor ni Redis', async () => {
    const redis = {
      appendTick: jest.fn(),
      readTicks: jest.fn().mockResolvedValue({ ticks: [] }),
    };
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ marketData: parseMarketDataConfig({}) })],
        }),
        RedisCacheModule,
        MarketDataModule,
      ],
    })
      .overrideProvider(RedisCacheService)
      .useValue(redis)
      .compile();
    const app = module.createNestApplication();
    try {
      await app.init();
      const config = app.get<MarketDataConfig>(MARKET_DATA_CONFIG);
      expect(config.enabled).toBe(false);
      expect(config.credentials).toBeUndefined();
      expect(app.get(MarketDataWsClient).getStatus().state).toBe('DISABLED');
      expect(redis.appendTick).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('inicia el cliente habilitado y libera el socket al cerrar Nest', async () => {
    const server = new AlpacaMockServer();
    const url = await server.start();
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              marketData: parseMarketDataConfig({
                MARKET_DATA_PROVIDER: 'alpaca',
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
      .useValue({})
      .compile();
    const app = module.createNestApplication();
    const client = app.get(MarketDataWsClient);
    try {
      await app.init();
      expect(client.getStatus().state).toBe('LIVE');
    } finally {
      await app.close();
      await server.stop();
    }
    expect(client.getStatus().state).toBe('STOPPED');
  });
});
