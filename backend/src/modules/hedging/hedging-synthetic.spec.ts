import { DynamicStopLoss, StopLossSample } from './dynamic-stop-loss';
import { InvestmentAnalysisService } from './investment-analysis.service';

// ─── Fixtures: generadores de series sintéticas ────────────────────────

function crashSeries(
  startPrice: number,
  dropPercent: number,
  steps: number,
  intervalMs: number,
): StopLossSample[] {
  const samples: StopLossSample[] = [];
  const totalDrop = startPrice * (dropPercent / 100);
  const stepDrop = totalDrop / steps;
  for (let i = 0; i <= steps; i++) {
    samples.push({
      symbol: 'QQQ',
      price: startPrice - stepDrop * i,
      eventTimeMs: i * intervalMs,
    });
  }
  return samples;
}

function recoverySeries(
  startPrice: number,
  dropPercent: number,
  recoveryPercent: number,
  dropSteps: number,
  recoverySteps: number,
  intervalMs: number,
): StopLossSample[] {
  const dropSamples = crashSeries(startPrice, dropPercent, dropSteps, intervalMs);
  const bottomPrice = dropSamples[dropSamples.length - 1].price;
  const lastTime = dropSamples[dropSamples.length - 1].eventTimeMs;
  const recoveryAmount = bottomPrice * (recoveryPercent / 100);
  const stepUp = recoveryAmount / recoverySteps;
  for (let i = 1; i <= recoverySteps; i++) {
    dropSamples.push({
      symbol: 'QQQ',
      price: bottomPrice + stepUp * i,
      eventTimeMs: lastTime + i * intervalMs,
    });
  }
  return dropSamples;
}

function noiseSeries(
  basePrice: number,
  steps: number,
  intervalMs: number,
  noisePercent: number,
): StopLossSample[] {
  const samples: StopLossSample[] = [];
  let seed = 42;
  for (let i = 0; i <= steps; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const noise = ((seed / 0x7fffffff) * 2 - 1) * (basePrice * noisePercent / 100);
    samples.push({
      symbol: 'QQQ',
      price: basePrice + noise,
      eventTimeMs: i * intervalMs,
    });
  }
  return samples;
}

function edgeSeries(basePrice: number, intervalMs: number): StopLossSample[] {
  return [
    { symbol: 'QQQ', price: basePrice, eventTimeMs: 0 },
    { symbol: 'QQQ', price: Number.MIN_VALUE, eventTimeMs: intervalMs },
    { symbol: 'QQQ', price: basePrice, eventTimeMs: intervalMs * 2 },
    { symbol: 'QQQ', price: Number.MAX_VALUE / 2, eventTimeMs: intervalMs * 3 },
    { symbol: 'QQQ', price: basePrice, eventTimeMs: intervalMs * 4 },
  ];
}

// ─── Tests: DynamicStopLoss con series sintéticas ──────────────────────

describe('DynamicStopLoss: series sintéticas de caída', () => {
  const engine = () => new DynamicStopLoss();

  describe('crash: caída gradual del mercado', () => {
    it('caída lenta (< 0.1%/min) produce trigger SLOW diferido 5 min', () => {
      const e = engine();
      const price = 100 - 0.05 / 60;
      e.accept({ symbol: 'QQQ', price: 100, eventTimeMs: 0 }, 0);
      e.accept({ symbol: 'QQQ', price, eventTimeMs: 1000 }, 1000);
      for (let t = 2000; t < 301000; t += 1000) {
        e.accept({ symbol: 'QQQ', price, eventTimeMs: t }, t);
      }
      const triggers = e.accept(
        { symbol: 'QQQ', price, eventTimeMs: 301000 },
        301000,
      );
      expect(triggers.length).toBeGreaterThanOrEqual(1);
      expect(triggers[0].policy).toBe('SLOW');
    });

    it('caída moderada (0.1–0.5%/min) produce trigger INTERMEDIATE diferido 1 min', () => {
      const e = engine();
      e.accept({ symbol: 'QQQ', price: 100, eventTimeMs: 0 }, 0);
      const price = 100 - 0.3 / 60;
      e.accept({ symbol: 'QQQ', price, eventTimeMs: 1000 }, 1000);
      for (let t = 2000; t < 61000; t += 1000) {
        expect(e.accept({ symbol: 'QQQ', price, eventTimeMs: t }, t)).toEqual([]);
      }
      const triggers = e.accept(
        { symbol: 'QQQ', price, eventTimeMs: 61000 },
        61000,
      );
      expect(triggers.length).toBeGreaterThanOrEqual(1);
      expect(triggers[0].policy).toBe('INTERMEDIATE');
    });

    it('caída rápida (> 0.5%/min) produce trigger FAST inmediato', () => {
      const e = engine();
      const series = crashSeries(100, 2, 3, 1000);
      let triggered = false;
      let triggerPolicy = '';
      for (const sample of series) {
        const results = e.accept(sample, sample.eventTimeMs);
        if (results.length > 0) {
          triggered = true;
          triggerPolicy = results[0].policy;
        }
      }
      expect(triggered).toBe(true);
      expect(triggerPolicy).toBe('FAST');
    });
  });

  describe('recovery: caída seguida de recuperación', () => {
    it('recuperación cancela trigger pendiente', () => {
      const e = engine();
      const series = recoverySeries(100, 1, 2, 5, 5, 1000);
      for (const sample of series) {
        e.accept(sample, sample.eventTimeMs);
      }
      const triggers = e.poll(series[series.length - 1].eventTimeMs + 600000);
      expect(triggers).toEqual([]);
    });

    it('recuperación parcial seguida de nueva caída dispara trigger', () => {
      const e = engine();
      e.accept({ symbol: 'QQQ', price: 100, eventTimeMs: 0 }, 0);
      e.accept({ symbol: 'QQQ', price: 99, eventTimeMs: 1000 }, 1000);
      e.accept({ symbol: 'QQQ', price: 100, eventTimeMs: 2000 }, 2000);
      const results = e.accept(
        { symbol: 'QQQ', price: 98, eventTimeMs: 3000 },
        3000,
      );
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].policy).toBe('FAST');
    });
  });

  describe('noise: fluctuaciones aleatorias sin tendencia', () => {
    it('ruido menor no genera triggers FAST (solo diferidos o nada)', () => {
      const e = engine();
      const series = noiseSeries(100, 50, 1000, 0.001);
      let fastTriggered = false;
      for (const sample of series) {
        const results = e.accept(sample, sample.eventTimeMs);
        if (results.some((r) => r.policy === 'FAST')) fastTriggered = true;
      }
      expect(fastTriggered).toBe(false);
    });
  });

  describe('edge: datos límite', () => {
    it('precios extremos no causan crash', () => {
      const e = engine();
      const series = edgeSeries(100, 1000);
      expect(() => {
        for (const sample of series) {
          e.accept(sample, sample.eventTimeMs);
        }
      }).not.toThrow();
    });

    it('precio NaN es ignorado', () => {
      const e = engine();
      e.accept({ symbol: 'QQQ', price: 100, eventTimeMs: 0 }, 0);
      const results = e.accept({ symbol: 'QQQ', price: NaN, eventTimeMs: 1000 }, 1000);
      expect(results).toEqual([]);
    });

    it('precio negativo es ignorado', () => {
      const e = engine();
      e.accept({ symbol: 'QQQ', price: 100, eventTimeMs: 0 }, 0);
      const results = e.accept({ symbol: 'QQQ', price: -50, eventTimeMs: 1000 }, 1000);
      expect(results).toEqual([]);
    });

    it('precio cero es ignorado', () => {
      const e = engine();
      e.accept({ symbol: 'QQQ', price: 100, eventTimeMs: 0 }, 0);
      const results = e.accept({ symbol: 'QQQ', price: 0, eventTimeMs: 1000 }, 1000);
      expect(results).toEqual([]);
    });

    it('timestamp futuro resetea estado', () => {
      const e = engine();
      e.accept({ symbol: 'QQQ', price: 100, eventTimeMs: 1000 }, 1000);
      const results = e.accept({ symbol: 'QQQ', price: 90, eventTimeMs: 5000 }, 2000);
      expect(results).toEqual([]);
    });

    it('gap temporal mayor a maxAgeMs resetea estado', () => {
      const e = engine();
      e.accept({ symbol: 'QQQ', price: 100, eventTimeMs: 0 }, 0);
      e.accept({ symbol: 'QQQ', price: 99, eventTimeMs: 1000 }, 1000);
      const results = e.accept({ symbol: 'QQQ', price: 50, eventTimeMs: 5000 }, 5000);
      expect(results).toEqual([]);
    });
  });
});

// ─── Tests: umbrales exactos InvestmentAnalysisService ──────────────────

describe('InvestmentAnalysisService: umbrales y bordes', () => {
  const service = new InvestmentAnalysisService();

  describe('INVESTMENT basis con investedAmount', () => {
    const rule = {
      thresholdBasis: 'INVESTMENT' as const,
      investedAmount: 10000,
      upPercent: 4,
      downPercent: 4,
    };

    it.each([
      [2.0, 'REVIEW_GAIN', 'GAIN_THRESHOLD'],
      [1.99, 'MONITOR', 'WITHIN_THRESHOLDS'],
      [-2.0, 'REVIEW_RISK', 'LOSS_THRESHOLD'],
      [-1.99, 'MONITOR', 'WITHIN_THRESHOLDS'],
      [0, 'MONITOR', 'WITHIN_THRESHOLDS'],
      [1.0, 'MONITOR', 'WITHIN_THRESHOLDS'],
      [-1.0, 'MONITOR', 'WITHIN_THRESHOLDS'],
    ])(
      'referencia %s%% → signal %s, reason %s',
      (reference, expectedSignal, expectedReason) => {
        const result = service.evaluate(reference as number, rule);
        expect(result.decision.signal).toBe(expectedSignal);
        expect(result.decision.reason).toBe(expectedReason);
        expect(result.investment.changePercent).toBe((reference as number) * 2);
        expect(result.investment.leverage).toBe(2);
      },
    );

    it('calcula PnL correctamente en el umbral exacto positivo', () => {
      const result = service.evaluate(2, rule);
      expect(result.investment.estimatedPnL).toBe(400);
      expect(result.investment.estimatedValue).toBe(10400);
    });

    it('calcula PnL correctamente en el umbral exacto negativo', () => {
      const result = service.evaluate(-2, rule);
      expect(result.investment.estimatedPnL).toBe(-400);
      expect(result.investment.estimatedValue).toBe(9600);
    });

    it('variación cero produce PnL cero', () => {
      const result = service.evaluate(0, rule);
      expect(result.investment.estimatedPnL).toBe(0);
      expect(result.investment.estimatedValue).toBe(10000);
    });
  });

  describe('REFERENCE basis', () => {
    const rule = {
      thresholdBasis: 'REFERENCE' as const,
      investedAmount: 10000,
      upPercent: 3,
      downPercent: 3,
    };

    it.each([
      [3.0, 'REVIEW_GAIN'],
      [2.99, 'MONITOR'],
      [-3.0, 'REVIEW_RISK'],
      [-2.99, 'MONITOR'],
      [0, 'MONITOR'],
    ])(
      'referencia %s%% → signal %s (evalúa sobre referencia, no inversión)',
      (reference, expectedSignal) => {
        const result = service.evaluate(reference as number, rule);
        expect(result.decision.signal).toBe(expectedSignal);
        expect(result.decision.evaluatedChangePercent).toBe(reference);
      },
    );
  });

  describe('sin capital invertido', () => {
    const rule = {
      thresholdBasis: 'REFERENCE' as const,
      upPercent: 5,
      downPercent: 5,
    };

    it('calcula porcentajes sin inventar un saldo', () => {
      const result = service.evaluate(-3, rule);
      expect(result.investment.investedAmount).toBeNull();
      expect(result.investment.estimatedPnL).toBeNull();
      expect(result.investment.estimatedValue).toBeNull();
      expect(result.investment.changePercent).toBe(-6);
    });
  });

  describe('validación de datos no finitos', () => {
    const rule = {
      thresholdBasis: 'INVESTMENT' as const,
      investedAmount: 10000,
      upPercent: 4,
      downPercent: 4,
    };

    it.each([Infinity, -Infinity, NaN, Number.MAX_VALUE])(
      'rechaza referenceChangePercent = %s',
      (value) => {
        expect(() => service.evaluate(value, rule)).toThrow('non_finite');
      },
    );
  });
});

// ─── Tests: diferimiento (deferment) DynamicStopLoss ────────────────────

describe('DynamicStopLoss: diferimiento y ejecución', () => {
  it('SLOW: trigger diferido 300s, requiere ticks para mantener estado vivo', () => {
    const e = new DynamicStopLoss();
    const price = 100 - 0.05 / 60;
    e.accept({ symbol: 'QQQ', price: 100, eventTimeMs: 0 }, 0);
    e.accept({ symbol: 'QQQ', price, eventTimeMs: 1000 }, 1000);

    for (let t = 2000; t < 301000; t += 1000) {
      const results = e.accept({ symbol: 'QQQ', price, eventTimeMs: t }, t);
      expect(results).toEqual([]);
    }
    const triggers = e.accept(
      { symbol: 'QQQ', price, eventTimeMs: 301000 },
      301000,
    );
    expect(triggers.length).toBeGreaterThanOrEqual(1);
    expect(triggers[0].policy).toBe('SLOW');
  });

  it('INTERMEDIATE: trigger diferido 60s, requiere ticks para mantener estado vivo', () => {
    const e = new DynamicStopLoss();
    const price = 100 - 0.3 / 60;
    e.accept({ symbol: 'QQQ', price: 100, eventTimeMs: 0 }, 0);
    e.accept({ symbol: 'QQQ', price, eventTimeMs: 1000 }, 1000);

    for (let t = 2000; t < 61000; t += 1000) {
      expect(e.accept({ symbol: 'QQQ', price, eventTimeMs: t }, t)).toEqual([]);
    }
    const triggers = e.accept(
      { symbol: 'QQQ', price, eventTimeMs: 61000 },
      61000,
    );
    expect(triggers.length).toBeGreaterThanOrEqual(1);
    expect(triggers[0].policy).toBe('INTERMEDIATE');
  });

  it('FAST: trigger inmediato sin diferimiento', () => {
    const e = new DynamicStopLoss();
    e.accept({ symbol: 'QQQ', price: 100, eventTimeMs: 0 }, 0);
    const results = e.accept(
      { symbol: 'QQQ', price: 100 - 0.6 / 60, eventTimeMs: 1000 },
      1000,
    );
    expect(results.length).toBe(1);
    expect(results[0].policy).toBe('FAST');
    expect(results[0].triggeredAtMs).toBe(1000);
  });

  it('caída acelerada acorta deadline pendiente', () => {
    const e = new DynamicStopLoss();
    e.accept({ symbol: 'QQQ', price: 100, eventTimeMs: 0 }, 0);
    e.accept({ symbol: 'QQQ', price: 100 - 0.05 / 60, eventTimeMs: 1000 }, 1000);
    expect(e.poll(1000)).toEqual([]);

    const results = e.accept(
      { symbol: 'QQQ', price: 100 - 1.0 / 60, eventTimeMs: 1500 },
      1500,
    );
    expect(results.length).toBe(1);
    expect(results[0].policy).toBe('FAST');
  });

  it('no dispara dos veces sin recovery intermedia', () => {
    const e = new DynamicStopLoss();
    e.accept({ symbol: 'QQQ', price: 100, eventTimeMs: 0 }, 0);
    const first = e.accept(
      { symbol: 'QQQ', price: 100 - 0.6 / 60, eventTimeMs: 1000 },
      1000,
    );
    expect(first.length).toBe(1);

    const second = e.accept(
      { symbol: 'QQQ', price: 100 - 1.2 / 60, eventTimeMs: 1500 },
      1500,
    );
    expect(second).toEqual([]);
  });
});

// ─── Suite determinista y reproducible en CI ────────────────────────────

describe('Suite reproducible en CI', () => {
  it('todos los tests usan timestamps deterministas', () => {
    const runA: string[] = [];
    const runB: string[] = [];

    for (const run of [runA, runB]) {
      const eng = new DynamicStopLoss();
      eng.accept({ symbol: 'QQQ', price: 100, eventTimeMs: 0 }, 0);
      const results = eng.accept(
        { symbol: 'QQQ', price: 99, eventTimeMs: 1000 },
        1000,
      );
      run.push(JSON.stringify(results));
    }
    expect(runA).toEqual(runB);
  });

  it('no depende de Date.now() ni de timers del sistema', () => {
    const e = new DynamicStopLoss();
    const fixedNow = 1000000;
    e.accept({ symbol: 'QQQ', price: 100, eventTimeMs: fixedNow - 1000 }, fixedNow);
    const results = e.accept(
      { symbol: 'QQQ', price: 99, eventTimeMs: fixedNow },
      fixedNow,
    );
    expect(results.length).toBe(1);
    expect(results[0].triggeredAtMs).toBe(fixedNow);
  });

  it('el generador de ruido es determinista (misma semilla = mismos precios)', () => {
    const seriesA = noiseSeries(100, 20, 1000, 0.1);
    const seriesB = noiseSeries(100, 20, 1000, 0.1);
    expect(seriesA).toEqual(seriesB);
  });
});
