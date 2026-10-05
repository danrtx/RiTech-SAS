import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NdxHistoryService } from './ndx-history.service';
import { NdxHistoryController } from './ndx-history.controller';
import { InvestmentAnalysisService } from '../hedging/investment-analysis.service';

const row = (date: string, close: number) => ({
  t: Date.parse(`${date}T04:00:00Z`),
  o: close,
  h: close,
  l: close,
  c: close,
});
const payload = (
  rows = [row('2026-09-28', 20000), row('2026-09-29', 20400)],
) => ({
  ticker: 'I:NDX',
  status: 'OK',
  results: rows,
});

describe('NDX real historical contract (provider responses simulated in tests)', () => {
  let service: NdxHistoryService;
  afterEach(() => jest.restoreAllMocks());
  beforeEach(() => {
    service = new NdxHistoryService(
      new ConfigService({ MASSIVE_API_KEY: 'sentinel-secret' }),
      new InvestmentAnalysisService(),
    );
  });
  it.each([
    [20400, 4, 400, 10400],
    [19600, -4, -400, 9600],
  ])(
    'uses the actual NDX symbol and closing dates: %s → %s%%',
    async (close, change, pnl, value) => {
      const upstream = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          Response.json(
            payload([row('2026-09-28', 20000), row('2026-09-29', close)]),
          ),
        );
      const result = await service.evaluate({
        entryDate: '2026-09-28',
        valuationDate: '2026-09-29',
        investedAmount: 10000,
        upPercent: 4,
        downPercent: 4,
      });
      expect(result).toMatchObject({
        marketReference: {
          sourceSymbol: 'I:NDX',
          instrumentType: 'INDEX',
          simulated: false,
        },
        dataMode: 'HISTORICAL_DAILY_CLOSE',
        referencePrice: 20000,
        investment: {
          model: 'SIMPLE_2X',
          changePercent: change,
          estimatedPnL: pnl,
          estimatedValue: value,
        },
      });
      expect(upstream.mock.calls[0][0]).toContain('/ticker/I:NDX/range/1/day/');
      expect(upstream.mock.calls[0][0]).not.toContain('sentinel');
      expect(upstream.mock.calls[0][1]).toMatchObject({
        redirect: 'error',
        headers: { Authorization: 'Bearer sentinel-secret' },
      });
    },
  );
  it('requires a configured account and never silently substitutes QQQ or simulated data', async () => {
    const upstream = jest.spyOn(global, 'fetch');
    const unavailable = new NdxHistoryService(
      new ConfigService({}),
      new InvestmentAnalysisService(),
    );
    await expect(
      unavailable.history('2026-09-28', '2026-09-29'),
    ).rejects.toThrow('ndx_credentials_missing');
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([
    ['2026-02-30', '2026-09-29'],
    ['2026-09-29', '2026-09-28'],
    ['2024-01-01', '2026-01-01'],
    ['2026-09-28', '2999-01-01'],
  ])('rejects invalid or unclosed date ranges %s %s', async (from, to) => {
    const upstream = jest.spyOn(global, 'fetch');
    await expect(service.history(from, to)).rejects.toThrow();
    expect(upstream).not.toHaveBeenCalled();
  });
  it('does not replace a missing trading date with another day', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(Response.json(payload([])));
    await expect(
      service.evaluate({
        entryDate: '2026-09-28',
        valuationDate: '2026-09-29',
        investedAmount: 10000,
        upPercent: 4,
        downPercent: 4,
      }),
    ).rejects.toThrow('No hay cierre');
  });
  it.each([
    { ...payload(), ticker: 'QQQ' },
    { ...payload(), next_url: 'https://unexpected.test' },
    payload([row('2026-09-28', 0)]),
    payload([row('2026-09-28', 100), row('2026-09-28', 101)]),
    payload([{ ...row('2026-09-28', 100), h: 99 }]),
  ])('rejects malformed or mismatched provider history', async (body) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(Response.json(body));
    await expect(service.history('2026-09-28', '2026-09-29')).rejects.toThrow(
      'ndx_history_unavailable',
    );
  });
  it('sanitizes HTTP and network errors', async () => {
    const upstream = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('sentinel-secret', { status: 403 }));
    await expect(service.history('2026-09-28', '2026-09-29')).rejects.toThrow(
      'ndx_http_403',
    );
    upstream.mockRejectedValue(new Error('sentinel-secret'));
    await expect(service.history('2026-09-28', '2026-09-29')).rejects.toThrow(
      'ndx_history_unavailable',
    );
  });
});

describe('NDX HTTP validation', () => {
  let app: INestApplication;
  const evaluate = jest.fn().mockResolvedValue({ status: 'READY' });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule],
      controllers: [NdxHistoryController],
      providers: [{ provide: NdxHistoryService, useValue: { evaluate } }],
    }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app.close();
  });
  it('accepts numeric capital and rejects extra fields/strings before querying the provider', async () => {
    const input = {
      entryDate: '2026-09-28',
      valuationDate: '2026-09-29',
      investedAmount: 10000,
      upPercent: 4,
      downPercent: 4,
    };
    const post = (body: object) =>
      fetch(`${awaitUrl}/market-data/index/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const awaitUrl = await app.getUrl();
    expect((await post(input)).status).toBe(200);
    expect((await post({ ...input, investedAmount: '10000' })).status).toBe(
      400,
    );
    expect((await post({ ...input, apiKey: 'do-not-accept' })).status).toBe(
      400,
    );
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});
