import { InvestmentAnalysisService } from './investment-analysis.service';

describe('Modelo RiTech: exposición al doble de la referencia', () => {
  const service = new InvestmentAnalysisService();
  const rule = {
    thresholdBasis: 'INVESTMENT' as const,
    investedAmount: 10000,
    upPercent: 4,
    downPercent: 4,
  };

  it.each([
    [2, 4, 400, 10400, 'REVIEW_GAIN'],
    [-2, -4, -400, 9600, 'REVIEW_RISK'],
    [0, 0, 0, 10000, 'MONITOR'],
  ])(
    'referencia %s%% → inversión %s%%',
    (reference, change, pnl, value, signal) => {
      const result = service.evaluate(reference as number, rule);
      expect(result.investment).toMatchObject({
        leverage: 2,
        changePercent: change,
        estimatedPnL: pnl,
        estimatedValue: value,
      });
      expect(result.decision.signal).toBe(signal);
    },
  );

  it('distingue umbrales de la inversión y de la referencia', () => {
    expect(
      service.evaluate(2, { ...rule, thresholdBasis: 'REFERENCE' }).decision
        .signal,
    ).toBe('MONITOR');
    expect(service.evaluate(2, rule).decision.signal).toBe('REVIEW_GAIN');
  });

  it('sin capital permite analizar porcentajes sin inventar un saldo', () => {
    const { investment } = service.evaluate(-2, {
      thresholdBasis: 'REFERENCE',
      upPercent: 2,
      downPercent: 2,
    });
    expect(investment).toMatchObject({
      changePercent: -4,
      investedAmount: null,
      estimatedPnL: null,
      estimatedValue: null,
    });
  });

  it('rechaza resultados no finitos', () => {
    expect(() => service.evaluate(Infinity, rule)).toThrow('non_finite');
    expect(() => service.evaluate(Number.MAX_VALUE, rule)).toThrow(
      'non_finite',
    );
  });
});
