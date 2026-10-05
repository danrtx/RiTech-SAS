import { Injectable } from "@nestjs/common";
import { TelemetryGateway } from "./telemetry.gateway";
import { RedisCacheService } from "../redis-cache/redis-cache.service";
import { MarketClock, Tick } from "../market-data/market.types";

@Injectable()
export class TelemetryService {
  constructor(
    private readonly gateway: TelemetryGateway,
    private readonly cache: RedisCacheService,
    private readonly clock: MarketClock,
  ) {}
  /** Provider adapters retain stable IDs and eventTime on replay. */
  async processIncomingTick(input: Omit<Tick, "receivedAt">) {
    const tick: Tick = { ...input, receivedAt: this.clock.now() };
    const result = await this.cache.appendTick(tick);
    if (result.accepted) this.gateway.broadcastTick(tick.symbol, tick);
    return result;
  }
}
