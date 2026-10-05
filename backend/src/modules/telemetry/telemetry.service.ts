import { Injectable, Logger } from '@nestjs/common';
import { TelemetryGateway } from './telemetry.gateway';
import { RedisCacheService } from '../redis-cache/redis-cache.service';

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(
    private readonly telemetryGateway: TelemetryGateway,
    private readonly redisCacheService: RedisCacheService,
  ) {}

  async processIncomingTick(symbol: string, price: number, volume: number) {
    const tickPayload = { price, volume, timestamp: Date.now() };

    // 1. Cache tick data in Redis (rolling window/quick access)
    await this.redisCacheService.setTick(symbol, tickPayload);
    await this.redisCacheService.pushATRWindow(symbol, price);

    // 2. Broadcast via WebSocket Gateway
    this.telemetryGateway.broadcastTick(symbol, tickPayload);
  }
}
