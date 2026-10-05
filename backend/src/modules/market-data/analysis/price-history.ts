import { MarketTick } from '../dto/market-tick.dto';

/** Buffer circular: inserción O(1), referencias por búsqueda binaria y memoria acotada. */
export class PriceHistory {
  private readonly points: (MarketTick | undefined)[];
  private head = 0;
  private count = 0;
  private evicted = 0;

  constructor(
    private readonly capacity: number,
    private readonly retentionMs: number,
    private readonly toleranceMs: number,
  ) {
    this.points = new Array(capacity);
  }

  private at(index: number): MarketTick {
    return this.points[(this.head + index) % this.capacity]!;
  }

  private removeFirst(): void {
    this.points[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.count--;
  }

  append(tick: MarketTick): void {
    if (this.count && tick.eventTimeMs < this.at(this.count - 1).eventTimeMs) {
      throw new Error('history_out_of_order');
    }
    const cutoff = tick.eventTimeMs - this.retentionMs - this.toleranceMs;
    while (this.count && this.at(0).eventTimeMs < cutoff) this.removeFirst();
    if (this.count === this.capacity) {
      this.removeFirst();
      this.evicted++;
    }
    this.points[(this.head + this.count) % this.capacity] = tick;
    this.count++;
  }

  reference(targetMs: number): MarketTick | undefined {
    let low = 0;
    let high = this.count - 1;
    let result: MarketTick | undefined;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const point = this.at(middle);
      if (point.eventTimeMs <= targetMs) {
        result = point;
        low = middle + 1;
      } else high = middle - 1;
    }
    return result && targetMs - result.eventTimeMs <= this.toleranceMs
      ? result
      : undefined;
  }

  latest(): MarketTick | undefined {
    return this.count ? this.at(this.count - 1) : undefined;
  }
  earliest(): MarketTick | undefined {
    return this.count ? this.at(0) : undefined;
  }

  snapshot(limit = 500): readonly MarketTick[] {
    const start = Math.max(0, this.count - limit);
    return Array.from({ length: this.count - start }, (_, index) =>
      this.at(start + index),
    );
  }

  getMetadata() {
    return {
      points: this.count,
      capacity: this.capacity,
      retentionMs: this.retentionMs,
      evictedByCapacity: this.evicted,
      oldestEventTimeMs: this.earliest()?.eventTimeMs,
      latestEventTimeMs: this.latest()?.eventTimeMs,
    };
  }

  clear(): void {
    this.points.fill(undefined);
    this.head = 0;
    this.count = 0;
    this.evicted = 0;
  }
}
