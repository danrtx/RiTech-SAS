export interface StopLossSample {
  symbol: string;
  price: number;
  eventTimeMs: number;
}

export interface StopLossTrigger {
  schemaVersion: 1;
  correlationId: string;
  symbol: string;
  price: number;
  eventTimeMs: number;
  detectedAtMs: number;
  triggeredAtMs: number;
  fallPercentPerMinute: number;
  policy: "SLOW" | "INTERMEDIATE" | "FAST";
  action: "STOP_LOSS_REQUEST";
}

interface State {
  last: StopLossSample;
  anchor?: number;
  pending?: StopLossTrigger & { dueAtMs: number };
  fired: boolean;
}

/** Pure state machine. A trigger is an execution request, not a broker fill. */
export class DynamicStopLoss {
  private readonly states = new Map<string, State>();
  constructor(private readonly maxAgeMs = 2000) {}

  reset(symbol?: string): void {
    if (symbol) this.states.delete(symbol);
    else this.states.clear();
  }

  accept(sample: StopLossSample, nowMs: number): StopLossTrigger[] {
    if (
      !/^[A-Za-z0-9._-]{1,32}$/.test(sample.symbol) ||
      !Number.isFinite(sample.price) ||
      sample.price <= 0 ||
      !Number.isFinite(sample.eventTimeMs) ||
      !Number.isFinite(nowMs)
    )
      return [];
    if (
      sample.eventTimeMs > nowMs ||
      nowMs - sample.eventTimeMs > this.maxAgeMs
    ) {
      this.reset(sample.symbol);
      return [];
    }
    let state = this.states.get(sample.symbol);
    if (!state) {
      if (this.states.size >= 128) return [];
      this.states.set(sample.symbol, { last: { ...sample }, fired: false });
      return [];
    }
    if (sample.eventTimeMs <= state.last.eventTimeMs) return [];
    if (sample.eventTimeMs - state.last.eventTimeMs > this.maxAgeMs) {
      this.reset(sample.symbol);
      return this.accept(sample, nowMs);
    }
    const previous = state.last;
    state.last = { ...sample };
    if (state.anchor !== undefined && sample.price >= state.anchor) {
      state = { last: { ...sample }, fired: false };
      this.states.set(sample.symbol, state);
    }
    const rate =
      (((previous.price - sample.price) / previous.price) * 100 * 60000) /
      (sample.eventTimeMs - previous.eventTimeMs);
    if (!Number.isFinite(rate) || rate <= 0 || state.fired)
      return this.poll(nowMs);
    // Tolerance only removes arithmetic noise at the two exact boundaries.
    const policy =
      rate < 0.1 - 1e-10
        ? "SLOW"
        : rate > 0.5 + 1e-10
          ? "FAST"
          : "INTERMEDIATE";
    const delay =
      policy === "SLOW" ? 300000 : policy === "INTERMEDIATE" ? 60000 : 0;
    const dueAtMs = nowMs + delay;
    state.anchor ??= previous.price;
    // A worsening fall can shorten the deadline; repeated ticks never postpone it.
    if (!state.pending || dueAtMs < state.pending.dueAtMs) {
      state.pending = {
        schemaVersion: 1,
        correlationId: `${sample.symbol}:${sample.eventTimeMs}`,
        symbol: sample.symbol,
        price: sample.price,
        eventTimeMs: sample.eventTimeMs,
        detectedAtMs: nowMs,
        triggeredAtMs: nowMs,
        fallPercentPerMinute: rate,
        policy,
        action: "STOP_LOSS_REQUEST",
        dueAtMs,
      };
    }
    return this.poll(nowMs);
  }

  poll(nowMs: number): StopLossTrigger[] {
    const triggers: StopLossTrigger[] = [];
    for (const [symbol, state] of this.states) {
      if (nowMs - state.last.eventTimeMs > this.maxAgeMs) {
        this.states.delete(symbol);
        continue;
      }
      if (!state.pending || state.pending.dueAtMs > nowMs) continue;
      const pending = state.pending;
      triggers.push({
        schemaVersion: 1,
        correlationId: pending.correlationId,
        symbol,
        price: state.last.price,
        eventTimeMs: state.last.eventTimeMs,
        detectedAtMs: pending.detectedAtMs,
        triggeredAtMs: nowMs,
        fallPercentPerMinute: pending.fallPercentPerMinute,
        policy: pending.policy,
        action: pending.action,
      });
      state.pending = undefined;
      state.fired = true;
    }
    return triggers;
  }
}
