import { backtest } from './backtest';
const config = { initialCapital: 1000, costBps: 0, slippageBps: 0, maxGapMs: 2000 };
const samples = (prices: number[]) => prices.map((price, i) => ({ symbol: 'NDX', price, eventTimeMs: i * 1000 }));
describe('backtest accounting', () => {
  it('fills after the signal, including losses between trigger and fill', () => {
    const result = backtest(samples([100, 99, 90, 110]), config);
    expect(result.executions[0]).toEqual({ eventTimeMs: 2000, price: 90, quantity: 10 });
    expect(result.maximumDrawdownPercent).toBeCloseTo(-10);
    expect(result.returnPercent).toBeCloseTo(-10);
  });
  it('marks an unfilled final signal without inventing execution', () => {
    expect(backtest(samples([100, 90]), config)).toMatchObject({ pendingAtEnd: true, executions: [] });
  });
  it('accounts for entry and exit costs', () => {
    const result = backtest(samples([100, 99, 99]), { ...config, costBps: 10, slippageBps: 10 });
    expect(result.equity[2].value).toBeCloseTo(1000 / (100 * 1.001 * 1.001) * 99 * 0.999 * 0.999);
  });
  it('rejects unordered or invalid data', () => {
    expect(() => backtest(samples([100, NaN]), config)).toThrow();
    expect(() => backtest(samples([100, 99]).reverse(), config)).toThrow();
  });
  it('cancels pending orders across an unobserved gap', () => {
    const data = samples([100, 99, 90]); data[2].eventTimeMs = 10000;
    expect(backtest(data, config)).toMatchObject({ gaps: 1, executions: [] });
  });
});
