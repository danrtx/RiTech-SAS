import { DynamicStopLoss, StopLossSample } from '../hedging/dynamic-stop-loss';

export interface BacktestConfig {
  initialCapital: number;
  costBps: number;
  slippageBps: number;
  maxGapMs: number;
}

/** Long-only liquidation benchmark. Execution occurs on the next observation. */
export function backtest(samples: StopLossSample[], config: BacktestConfig) {
  if (samples.length < 2 || !Number.isFinite(config.initialCapital) || config.initialCapital <= 0 ||
    !Number.isFinite(config.maxGapMs) || config.maxGapMs <= 0 ||
    [config.costBps, config.slippageBps].some(n => !Number.isFinite(n) || n < 0 || n >= 10000))
    throw new Error('Invalid backtest configuration or empty dataset');
  samples.forEach((s, i) => {
    if (!Number.isFinite(s.price) || s.price <= 0 || !Number.isSafeInteger(s.eventTimeMs) ||
      !/^[A-Za-z0-9._-]{1,32}$/.test(s.symbol) || s.symbol !== samples[0].symbol ||
      (i > 0 && s.eventTimeMs <= samples[i - 1].eventTimeMs)) throw new Error('Invalid, mixed or unordered samples');
  });
  const engine = new DynamicStopLoss(config.maxGapMs);
  const fee = config.costBps / 10000;
  const slip = config.slippageBps / 10000;
  let quantity = config.initialCapital / (samples[0].price * (1 + slip) * (1 + fee));
  const initialQuantity = quantity;
  let baselinePeak = config.initialCapital;
  let baselineDrawdown = 0;
  let baselineValue = config.initialCapital;
  let feesPaid = quantity * samples[0].price * (1 + slip) * fee;
  let slippageCost = quantity * samples[0].price * slip;
  let cash = 0;
  let peak = config.initialCapital;
  let maximumDrawdownPercent = 0;
  let pending = false;
  let gaps = 0;
  const executions: { eventTimeMs: number; price: number; quantity: number }[] = [];
  const equity: { eventTimeMs: number; value: number; drawdownPercent: number }[] = [];
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (i && sample.eventTimeMs - samples[i - 1].eventTimeMs > config.maxGapMs) {
      gaps++;
      engine.reset();
      pending = false;
    }
    if (pending && quantity > 0) {
      const price = sample.price * (1 - slip);
      executions.push({ eventTimeMs: sample.eventTimeMs, price, quantity });
      cash = quantity * price * (1 - fee);
      feesPaid += quantity * price * fee;
      slippageCost += quantity * sample.price * slip;
      quantity = 0;
      pending = false;
    }
    const value = cash + quantity * sample.price;
    baselineValue = initialQuantity * sample.price;
    baselinePeak = Math.max(baselinePeak, baselineValue);
    baselineDrawdown = Math.min(baselineDrawdown, (baselineValue / baselinePeak - 1) * 100);
    peak = Math.max(peak, value);
    const drawdownPercent = (value / peak - 1) * 100;
    maximumDrawdownPercent = Math.min(maximumDrawdownPercent, drawdownPercent);
    equity.push({ eventTimeMs: sample.eventTimeMs, value, drawdownPercent });
    if (quantity > 0 && engine.accept(sample, sample.eventTimeMs).length) pending = true;
  }
  return { config, model: 'LONG_ONLY_STOP_LOSS_NEXT_OBSERVATION', samples: samples.length,
    from: samples[0].eventTimeMs, to: samples[samples.length - 1].eventTimeMs,
    maximumDrawdownPercent, returnPercent: (equity[equity.length - 1].value / config.initialCapital - 1) * 100,
    gaps, pendingAtEnd: pending, executions, equity,
    finalEquity: equity[equity.length - 1].value,
    feesPaid, slippageCost, openQuantity: quantity,
    baseline: {
      model: 'BUY_AND_HOLD_MARK_TO_MARKET',
      finalEquity: baselineValue,
      returnPercent: (baselineValue / config.initialCapital - 1) * 100,
      maximumDrawdownPercent: baselineDrawdown,
      excessReturnPercentagePoints: (equity[equity.length - 1].value - baselineValue) / config.initialCapital * 100,
      valuation: 'Same entry costs; open positions marked to market, no forced final sale or assumed exit costs.',
    },
    riskLimitWithinTwoPercent: maximumDrawdownPercent >= -2 };
}
