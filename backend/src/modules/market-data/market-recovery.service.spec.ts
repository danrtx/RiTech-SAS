import { MarketRecoveryService } from './market-recovery.service';
import {
  MarketHistoryClient,
  marketIdentity,
  orderMarketTicks,
} from './market-history.client';
import { MarketDataProcessor } from './market-data.processor';
import { MarketAtrConsumer } from './market-atr.consumer';
import { RedisCacheService } from '../redis-cache/redis-cache.service';
import { PriceAnalysisService } from './analysis/price-analysis.service';
import { AtrService } from '../atr/atr.service';
import { IngestionState } from './ingestion.state';
import { parseMarketDataConfig } from './market-data.config';
import { AlpacaAdapter } from './adapters/alpaca.adapter';
import { normalizedTick } from './testing/market-tick.fixture';
import { MarketTick } from './dto/market-tick.dto';
import { createTradeFixture } from './testing/alpaca.fixtures';
import { waitUntil } from '../../testing/mock-provider';

describe('Recovery coordinator', () => {
  let recovery: MarketRecoveryService;
  let data: Map<string, MarketTick>;
  let history: { fetch: jest.Mock };
  let analysis: { restore: jest.Mock; resume: jest.Mock };
  let ingestion: IngestionState;
  let processor: {
    getStatus: jest.Mock;
    setLive: jest.Mock;
    whenSettled: jest.Mock;
    accept: jest.Mock;
    pause: jest.Mock;
  };
  const now = Date.now();
  beforeEach(() => {
    const config = parseMarketDataConfig({
      MARKET_DATA_PROVIDER: 'alpaca',
      MARKET_DATA_ENABLED: 'true',
      MARKET_DATA_FEED: 'mock',
      MARKET_DATA_RECOVERY_TIMEOUT_MS: '150',
    });
    data = new Map();
    const old = normalizedTick(now - 5000, 100, '1');
    data.set(marketIdentity(old), old);
    history = { fetch: jest.fn().mockResolvedValue([old]) };
    analysis = { restore: jest.fn(), resume: jest.fn() };
    ingestion = new IngestionState();
    processor = {
      getStatus: jest.fn().mockReturnValue({ live: false }),
      setLive: jest.fn(),
      whenSettled: jest.fn().mockResolvedValue(undefined),
      accept: jest.fn(),
      pause: jest.fn(),
    };
    recovery = new MarketRecoveryService(
      config,
      history as unknown as MarketHistoryClient,
      processor as unknown as MarketDataProcessor,
      {
        invalidate: () => ingestion.beginRecovery(),
        prepareRecovery: jest.fn(),
        consume: async (tick: MarketTick) => {
          data.set(marketIdentity(tick), tick);
        },
      } as unknown as MarketAtrConsumer,
      {
        recoveryWindow: async () => orderMarketTicks([...data.values()]),
      } as unknown as RedisCacheService,
      analysis as unknown as PriceAnalysisService,
      { rebuildRecovered: async () => undefined } as unknown as AtrService,
      ingestion,
      new AlpacaAdapter(config),
    );
  });
  afterEach(async () => {
    await recovery.onModuleDestroy();
  });
  it('restores a persisted checkpoint from before process startup and merges buffered live data', async () => {
    const missed = normalizedTick(now - 2000, 101, '2');
    let resolve!: (ticks: MarketTick[]) => void;
    history.fetch.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    recovery.live();
    await waitUntil(() => history.fetch.mock.calls.length > 0);
    recovery.accept({
      messages: [
        {
          ...createTradeFixture({
            i: 3,
            p: 102,
            t: new Date(now - 1000).toISOString(),
          }),
        },
      ],
      receivedAtMs: now,
      receivedAtMonotonicMs: performance.now(),
    });
    resolve([...data.values(), missed]);
    await waitUntil(() => recovery.getStatus().state === 'LIVE');
    expect(history.fetch.mock.calls[0][0]).toBe(now - 5000);
    expect([...data.values()].map((t) => t.eventId)).toEqual(['1', '2', '3']);
    expect(
      analysis.restore.mock.calls[0][0].map((t: MarketTick) => t.eventId),
    ).toEqual(['1', '2', '3']);
    expect(ingestion.recovering).toBe(false);
  });
  it('keeps the old window and gate on a failed query, then recovers on retry', async () => {
    history.fetch.mockRejectedValueOnce(new Error('history_http_503'));
    recovery.live();
    await waitUntil(() => recovery.getStatus().state === 'FAILED');
    expect(data.size).toBe(1);
    expect(analysis.resume).not.toHaveBeenCalled();
    expect(ingestion.recovering).toBe(true);
    recovery.live();
    await waitUntil(() => recovery.getStatus().state === 'LIVE');
    expect(history.fetch.mock.calls[1][0]).toBe(history.fetch.mock.calls[0][0]);
  });
  it('never resumes a cancelled recovery after another disconnect', async () => {
    let resolve!: (ticks: MarketTick[]) => void;
    history.fetch.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    recovery.live();
    await waitUntil(() => !!resolve);
    recovery.disconnected();
    resolve([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(analysis.resume).not.toHaveBeenCalled();
    expect(ingestion.recovering).toBe(true);
  });
  it('bounds a stalled request and reports failure without losing the window', async () => {
    history.fetch.mockImplementation(
      (_start, _end, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new Error('history_timeout')),
            { once: true },
          ),
        ),
    );
    recovery.live();
    await waitUntil(() => recovery.getStatus().state === 'FAILED');
    expect(data.size).toBe(1);
    expect(recovery.getStatus().lastError).toBe('history_timeout');
    expect(analysis.resume).not.toHaveBeenCalled();
  });
  it('does not accept an empty history when a persisted checkpoint must exist', async () => {
    history.fetch.mockResolvedValue([]);
    recovery.live();
    await waitUntil(() => recovery.getStatus().state === 'FAILED');
    expect(recovery.getStatus().lastError).toBe('history_checkpoint_missing');
    expect(ingestion.recovering).toBe(true);
    expect(analysis.resume).not.toHaveBeenCalled();
  });
  it('blocks corrections received during recovery instead of resuming stale prices', async () => {
    let resolve!: (ticks: MarketTick[]) => void;
    history.fetch.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    recovery.live();
    await waitUntil(() => !!resolve);
    recovery.accept({
      messages: [{ T: 'c' }],
      receivedAtMs: now,
      receivedAtMonotonicMs: performance.now(),
    });
    resolve([...data.values()]);
    await new Promise((r) => setTimeout(r, 20));
    expect(recovery.getStatus().state).toBe('FAILED');
    expect(recovery.getStatus().lastError).toBe(
      'recovery_requires_corrected_history',
    );
    expect(analysis.resume).not.toHaveBeenCalled();
    expect(ingestion.recovering).toBe(true);
  });
});
