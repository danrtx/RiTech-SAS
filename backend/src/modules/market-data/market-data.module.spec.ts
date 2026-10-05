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

describe('Arranque de MarketDataModule', () => {
  it('resuelve la configuración deshabilitada sin conectar al proveedor ni Redis', async () => {
    const redis = { setTick: jest.fn(), pushATRWindow: jest.fn() };
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
      expect(redis.setTick).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
