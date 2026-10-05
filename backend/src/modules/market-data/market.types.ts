import { Injectable } from "@nestjs/common";

export const MINUTE_MS = 60_000;
export const minuteStart = (timestamp: number): number =>
  Math.floor(timestamp / MINUTE_MS) * MINUTE_MS;

@Injectable()
export class MarketClock {
  now(): number {
    return Date.now();
  }
  monotonic(): number {
    return performance.now();
  }
}

export interface Tick {
  id: string;
  symbol: string;
  price: number;
  volume: number;
  /** UTC Unix milliseconds from the provider; never replaced on delivery. */
  eventTime: number;
  receivedAt: number;
}
export interface CachedTick extends Tick {
  sequence: number;
}
export interface TickSnapshot {
  ticks: CachedTick[];
  coverageStart?: number;
}
export type TickRejection =
  | "invalidTick"
  | "invalidPrice"
  | "invalidTimestamp"
  | "invalidVolume"
  | "unknownSymbol"
  | "duplicate"
  | "outOfOrder"
  | "late"
  | "expired";
export type AppendResult =
  { accepted: true } | { accepted: false; reason: TickRejection };

export function validateTick(
  value: unknown,
  now: number,
  symbols: readonly string[],
): TickRejection | null {
  if (typeof value !== "object" || value === null) return "invalidTick";
  const tick = value as Partial<Tick>;
  if (
    typeof tick.id !== "string" ||
    !tick.id.trim() ||
    tick.id.length > 256 ||
    typeof tick.symbol !== "string"
  )
    return "invalidTick";
  if (!symbols.includes(tick.symbol)) return "unknownSymbol";
  if (
    typeof tick.price !== "number" ||
    !Number.isFinite(tick.price) ||
    tick.price <= 0
  )
    return "invalidPrice";
  if (
    typeof tick.volume !== "number" ||
    !Number.isFinite(tick.volume) ||
    tick.volume < 0
  )
    return "invalidVolume";
  if (
    !Number.isSafeInteger(tick.eventTime) ||
    tick.eventTime! < 0 ||
    tick.eventTime! > now ||
    !Number.isSafeInteger(tick.receivedAt) ||
    tick.receivedAt! < tick.eventTime! ||
    tick.receivedAt! > now
  ) {
    return "invalidTimestamp";
  }
  return null;
}

export interface Candle {
  minute: number;
  open: number;
  high: number;
  low: number;
  close: number;
}
export type AtrStatus =
  "insufficientData" | "baselineWarmingUp" | "ready" | "gap" | "cacheError";
export interface AtrResult {
  symbol: string;
  minute: number;
  emittedAt: number;
  status: AtrStatus;
  atr: number | null;
  baseline: number | null;
  alert: boolean;
}
