import { PriceAnalysisService } from './price-analysis.service';
import { parseMarketDataConfig } from '../market-data.config';
import { PriceAlertRuleDto } from '../dto/price-alert.dto';
import { TelemetryGateway } from '../../telemetry/telemetry.gateway';
import { InvestmentAnalysisService } from '../../hedging/investment-analysis.service';
import {
  normalizedTick,
  TEST_TIME_MS as BASE,
} from '../testing/market-tick.fixture';

describe('Análisis de variación y alertas', () => {
  let service: PriceAnalysisService;
  let gateway: {
    broadcastMarketTick: jest.Mock;
    broadcastPriceAlert: jest.Mock;
    broadcastMarketDataQuality: jest.Mock;
    broadcastInvestmentUpdate: jest.Mock;
  };
  const defaultRule: PriceAlertRuleDto = {
    thresholdBasis: 'REFERENCE',
    windowMs: 300000,
    upPercent: 1,
    downPercent: 1,
    cooldownMs: 0,
    enabled: true,
  };

  beforeEach(() => {
    gateway = {
      broadcastMarketTick: jest.fn(),
      broadcastPriceAlert: jest.fn(),
      broadcastMarketDataQuality: jest.fn(),
      broadcastInvestmentUpdate: jest.fn(),
    };
    service = new PriceAnalysisService(
      parseMarketDataConfig({ MARKET_DATA_FEED: 'mock' }),
      gateway as unknown as TelemetryGateway,
      new InvestmentAnalysisService(),
    );
  });
  afterEach(() => jest.restoreAllMocks());

  async function tick(offset: number, price: number) {
    jest.spyOn(Date, 'now').mockReturnValue(BASE + offset);
    await service.consume(normalizedTick(BASE + offset, price));
  }

  it('espera historial y emite subida de 1% al completar la ventana de 5 minutos', async () => {
    service.upsertRule('qqq-5m', defaultRule);
    await tick(0, 100);
    expect(service.listRules()[0].analysis.status).toBe('WARMING_UP');
    expect(gateway.broadcastPriceAlert).not.toHaveBeenCalled();
    await tick(300000, 101);
    expect(service.listRules()[0].analysis).toMatchObject({
      status: 'READY',
      changePercent: 1,
      referencePrice: 100,
    });
    expect(gateway.broadcastPriceAlert).toHaveBeenCalledTimes(1);
    expect(gateway.broadcastPriceAlert.mock.calls[0][0]).toMatchObject({
      ruleId: 'qqq-5m',
      direction: 'up',
      windowMs: 300000,
      changePercent: 1,
      referenceTimeMs: BASE,
      eventTimeMs: BASE + 300000,
      feed: 'mock',
      simulated: true,
    });
    expect(service.getHistory().samples).toHaveLength(2);
  });

  it('no repite avisos dentro de la misma región y rearma después de volver al rango', async () => {
    service.upsertRule('rule', defaultRule);
    await tick(0, 100);
    await tick(300000, 101);
    await tick(300100, 102);
    expect(gateway.broadcastPriceAlert).toHaveBeenCalledTimes(1);
    await tick(300200, 100);
    await tick(300300, 99);
    expect(gateway.broadcastPriceAlert).toHaveBeenCalledTimes(2);
    expect(gateway.broadcastPriceAlert.mock.calls[1][0]).toMatchObject({
      direction: 'down',
      changePercent: -1,
    });
  });

  it('suprime cruces durante cooldown y exige un cruce nuevo para avisar después', async () => {
    service.upsertRule('rule', { ...defaultRule, cooldownMs: 1000 });
    await tick(0, 100);
    await tick(300000, 101);
    await tick(300100, 100);
    await tick(300200, 101);
    await tick(301100, 102);
    expect(gateway.broadcastPriceAlert).toHaveBeenCalledTimes(1);
    expect(service.getStatus().alertsSuppressed).toBe(1);
    await tick(301200, 100);
    await tick(301300, 101);
    expect(gateway.broadcastPriceAlert).toHaveBeenCalledTimes(2);
  });

  it('evalúa reglas con intervalos distintos sin mezclarlas', async () => {
    service.upsertRule('short', { ...defaultRule, windowMs: 1000 });
    service.upsertRule('long', defaultRule);
    await tick(0, 100);
    await tick(1000, 101);
    expect(
      gateway.broadcastPriceAlert.mock.calls.map(([alert]) => alert.ruleId),
    ).toEqual(['short']);
    expect(service.listRules()[1].analysis.status).toBe('WARMING_UP');
  });

  it('no evalúa una referencia demasiado alejada del tiempo objetivo', async () => {
    service.upsertRule('rule', defaultRule);
    await tick(0, 100);
    await tick(306000, 110);
    expect(service.listRules()[0].analysis.status).toBe('REFERENCE_GAP');
    expect(gateway.broadcastPriceAlert).not.toHaveBeenCalled();
  });

  it('muestra STALE cuando no llegan precios recientes y vuelve a esperar tras invalidación', async () => {
    service.upsertRule('rule', defaultRule);
    await tick(0, 100);
    await tick(300000, 100);
    jest.spyOn(Date, 'now').mockReturnValue(BASE + 302000);
    expect(service.listRules()[0].analysis.status).toBe('STALE');
    service.invalidate('correction');
    expect(service.getHistory().samples).toEqual([]);
    expect(service.getStatus().lastInvalidation).toBe('correction');
    await tick(303000, 110);
    expect(service.listRules()[0].analysis.status).toBe('WARMING_UP');
    expect(gateway.broadcastPriceAlert).not.toHaveBeenCalled();
  });

  it('no publica ticks abortados, ajenos o antiguos', async () => {
    const abort = new AbortController();
    abort.abort();
    jest.spyOn(Date, 'now').mockReturnValue(BASE);
    await service.consume(normalizedTick(), { signal: abort.signal });
    await expect(
      service.consume({ ...normalizedTick(), symbol: 'NDX' }),
    ).rejects.toThrow('source_mismatch');
    await expect(service.consume(normalizedTick(BASE - 1001))).rejects.toThrow(
      'stale_delivery',
    );
    expect(service.getHistory().samples).toEqual([]);
    expect(gateway.broadcastMarketTick).not.toHaveBeenCalled();
  });

  it('deshabilita, reemplaza y elimina reglas', async () => {
    service.upsertRule('rule', { ...defaultRule, enabled: false });
    await tick(0, 100);
    await tick(300000, 110);
    expect(service.listRules()[0].analysis.status).toBe('DISABLED');
    expect(gateway.broadcastPriceAlert).not.toHaveBeenCalled();
    service.upsertRule('rule', defaultRule);
    await tick(300100, 110);
    expect(gateway.broadcastPriceAlert).toHaveBeenCalledTimes(1);
    service.deleteRule('rule');
    expect(service.listRules()).toEqual([]);
    expect(() => service.deleteRule('rule')).toThrow('Regla no encontrada');
  });

  it('valida reglas, retención, identificadores y máximos sin guardar entradas inválidas', () => {
    expect(() =>
      service.upsertRule('rule', { ...defaultRule, investedAmount: -1 }),
    ).toThrow();
    expect(() =>
      service.upsertRule('rule', {
        ...defaultRule,
        thresholdBasis: 'NDX' as never,
      }),
    ).toThrow();
    expect(() => service.upsertRule('bad id', defaultRule)).toThrow();
    expect(() =>
      service.upsertRule('rule', { ...defaultRule, upPercent: 0 }),
    ).toThrow();
    expect(() =>
      service.upsertRule('rule', { ...defaultRule, windowMs: 3600001 }),
    ).toThrow();
    expect(() =>
      service.upsertRule('rule', { ...defaultRule, downPercent: Infinity }),
    ).toThrow();
    expect(service.listRules()).toEqual([]);
    const limited = new PriceAnalysisService(
      parseMarketDataConfig({
        MARKET_DATA_FEED: 'mock',
        MARKET_DATA_MAX_ALERT_RULES: '1',
      }),
      gateway as unknown as TelemetryGateway,
      new InvestmentAnalysisService(),
    );
    limited.upsertRule('one', defaultRule);
    expect(() => limited.upsertRule('two', defaultRule)).toThrow('máximo');
    expect(() => limited.upsertRule('one', defaultRule)).not.toThrow();
  });

  it('evalúa el impacto ×2 sin duplicar la variación de referencia ni acumular ventanas', async () => {
    service.upsertRule('investment', {
      ...defaultRule,
      thresholdBasis: 'INVESTMENT',
      upPercent: 4,
      downPercent: 4,
      investedAmount: 10000,
    });
    await tick(0, 100);
    await tick(300000, 102);
    expect(service.listRules()[0].analysis).toMatchObject({
      changePercent: 2,
      investment: {
        changePercent: 4,
        estimatedPnL: 400,
        estimatedValue: 10400,
      },
      decision: { signal: 'REVIEW_GAIN', evaluatedChangePercent: 4 },
    });
    await tick(300100, 102);
    expect(service.listRules()[0].analysis).toMatchObject({
      investment: { estimatedValue: 10400 },
    });
    expect(gateway.broadcastPriceAlert).toHaveBeenCalledTimes(1);
    expect(gateway.broadcastInvestmentUpdate).toHaveBeenCalledTimes(3);
    await tick(300200, 98);
    expect(gateway.broadcastPriceAlert.mock.calls[1][0]).toMatchObject({
      changePercent: -2,
      investment: { changePercent: -4, estimatedPnL: -400 },
      decision: { signal: 'REVIEW_RISK' },
    });
  });

  it('conserva el capital y la referencia de entrada aunque cambie la ventana o se reconecte', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(BASE);
    service.upsertRule('position', {
      referenceMode: 'ENTRY',
      entryPrice: 100,
      entryTimeMs: BASE,
      investedAmount: 10000,
      thresholdBasis: 'INVESTMENT',
      upPercent: 4,
      downPercent: 4,
      cooldownMs: 0,
      enabled: true,
    });
    await tick(0, 102);
    expect(service.listRules()[0].analysis).toMatchObject({
      status: 'READY',
      referenceMode: 'ENTRY',
      referencePrice: 100,
      investment: {
        model: 'SIMPLE_2X',
        changePercent: 4,
        estimatedPnL: 400,
        estimatedValue: 10400,
      },
    });
    await tick(7200000, 98);
    expect(service.listRules()[0].analysis).toMatchObject({
      investment: {
        changePercent: -4,
        estimatedPnL: -400,
        estimatedValue: 9600,
      },
    });
    service.suspend('connection_unavailable');
    expect(service.listRules()[0].analysis.status).toBe('UNAVAILABLE');
    service.restore([normalizedTick(BASE + 7200000, 98)], false);
    service.resume();
    expect(service.listRules()[0].analysis).toMatchObject({
      referencePrice: 100,
      investment: { estimatedValue: 9600 },
    });
    expect(gateway.broadcastPriceAlert).toHaveBeenCalledTimes(2);
    expect(gateway.broadcastInvestmentUpdate.mock.calls[0][0]).toMatchObject({
      referenceMode: 'ENTRY',
      referencePrice: 100,
      referenceTimeMs: BASE,
      marketReference: {
        sourceSymbol: 'QQQ',
        instrumentType: 'ETF_PROXY',
        matchesRequiredIndex: false,
      },
    });
  });

  it('rechaza referencias de entrada incompletas, futuras o mezcladas con ventanas', () => {
    jest.spyOn(Date, 'now').mockReturnValue(BASE);
    const entry = {
      ...defaultRule,
      windowMs: undefined,
      referenceMode: 'ENTRY' as const,
      entryPrice: 100,
      entryTimeMs: BASE,
      investedAmount: 10000,
    };
    for (const invalid of [
      { entryPrice: undefined },
      { entryTimeMs: undefined },
      { entryTimeMs: BASE + 1 },
      { entryPrice: 0 },
      { investedAmount: undefined },
      { windowMs: 1000 },
      { referenceMode: 'WINDOW' as const },
    ])
      expect(() =>
        service.upsertRule('bad', { ...entry, ...invalid }),
      ).toThrow();
    expect(service.listRules()).toEqual([]);
  });
});
