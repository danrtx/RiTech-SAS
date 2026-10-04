import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { RedisCacheService } from '../redis-cache/redis-cache.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  const dataSource = { query: jest.fn() };
  const redisClient = { ping: jest.fn() };
  const redisCache = { getClient: () => redisClient };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DataSource, useValue: dataSource },
        { provide: RedisCacheService, useValue: redisCache },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('responde ok cuando PostgreSQL y Redis están arriba', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    redisClient.ping.mockResolvedValue('PONG');

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.services.postgres.status).toBe('up');
    expect(result.services.redis.status).toBe('up');
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('lanza 503 cuando PostgreSQL falla', async () => {
    dataSource.query.mockRejectedValue(new Error('connection refused'));
    redisClient.ping.mockResolvedValue('PONG');

    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('lanza 503 cuando Redis no responde PONG', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    redisClient.ping.mockResolvedValue('NOPE');

    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('detalla el servicio caído en la respuesta de error', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    redisClient.ping.mockRejectedValue(new Error('ECONNREFUSED'));

    expect.assertions(1);
    try {
      await controller.check();
    } catch (err) {
      const body = (err as ServiceUnavailableException).getResponse() as {
        services: { redis: { status: string; error: string } };
      };
      expect(body.services.redis).toEqual({ status: 'down', error: 'ECONNREFUSED' });
    }
  });
});
