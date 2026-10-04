import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASS');

    this.client = new Redis({
      host,
      port,
      password: password || undefined,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    this.client.on('connect', () => {
      this.logger.log(`Successfully connected to Redis at ${host}:${port}`);
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis connection error: ${err.message}`, err.stack);
    });
  }

  getClient(): Redis {
    return this.client;
  }

  async setTick(symbol: string, tickData: Record<string, any>, ttlSeconds = 60): Promise<void> {
    const key = `tick:${symbol}:${Date.now()}`;
    await this.client.set(key, JSON.stringify(tickData), 'EX', ttlSeconds);
  }

  async pushATRWindow(symbol: string, value: number, maxWindow = 14): Promise<void> {
    const key = `atr:${symbol}`;
    const pipeline = this.client.pipeline();
    pipeline.lpush(key, value.toString());
    pipeline.ltrim(key, 0, maxWindow - 1);
    await pipeline.exec();
  }

  async getATRWindow(symbol: string): Promise<number[]> {
    const key = `atr:${symbol}`;
    const values = await this.client.lrange(key, 0, -1);
    return values.map(v => parseFloat(v));
  }

  onModuleDestroy() {
    this.client?.disconnect();
  }
}
