import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisCacheService } from '../redis-cache/redis-cache.service';

type ServiceStatus = { status: 'up' | 'down'; latencyMs?: number; error?: string };

const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout tras ${ms} ms`)), ms)),
  ]);
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redisCache: RedisCacheService,
  ) {}

  @Get()
  async check() {
    const [postgres, redis] = await Promise.all([this.checkPostgres(), this.checkRedis()]);
    const ok = postgres.status === 'up' && redis.status === 'up';

    const body = {
      status: ok ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      services: { postgres, redis },
    };

    if (!ok) {
      throw new ServiceUnavailableException(body);
    }
    return body;
  }

  private async checkPostgres(): Promise<ServiceStatus> {
    const start = Date.now();
    try {
      await withTimeout(this.dataSource.query('SELECT 1'), CHECK_TIMEOUT_MS);
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (err) {
      return { status: 'down', error: (err as Error).message };
    }
  }

  private async checkRedis(): Promise<ServiceStatus> {
    const start = Date.now();
    try {
      const reply = await withTimeout(this.redisCache.getClient().ping(), CHECK_TIMEOUT_MS);
      if (reply !== 'PONG') {
        return { status: 'down', error: `Respuesta inesperada: ${reply}` };
      }
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (err) {
      return { status: 'down', error: (err as Error).message };
    }
  }
}
