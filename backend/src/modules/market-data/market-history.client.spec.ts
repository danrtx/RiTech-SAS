import { MarketHistoryClient } from './market-history.client';
import { AlpacaAdapter } from './adapters/alpaca.adapter';
import { parseMarketDataConfig } from './market-data.config';
import { AlpacaMockServer } from './testing/alpaca-mock.server';
import { createTradeFixture } from './testing/alpaca.fixtures';

describe('Historical trades contract', () => {
  let mock: AlpacaMockServer;
  let history: MarketHistoryClient;
  let adapter: AlpacaAdapter;
  beforeEach(async () => {
    mock = new AlpacaMockServer();
    const url = await mock.start();
    const config = parseMarketDataConfig({
      MARKET_DATA_PROVIDER: 'alpaca',
      MARKET_DATA_ENABLED: 'true',
      MARKET_DATA_FEED: 'mock',
      MARKET_DATA_WS_URL: url,
      MARKET_DATA_HISTORY_PAGE_SIZE: '2',
    });
    adapter = new AlpacaAdapter(config);
    history = new MarketHistoryClient(config, adapter);
  });
  afterEach(async () => {
    await mock.stop();
    jest.restoreAllMocks();
  });
  it('paginates provider history even when no websocket was connected, preserving original times', async () => {
    const time = Date.now() - 5000;
    const rows = Array.from({ length: 7 }, (_, i) =>
      createTradeFixture({ i: i + 1, t: new Date(time + i).toISOString() }),
    );
    mock.publish(rows);
    expect(
      adapter.normalize(
        rows[0] as unknown as Record<string, unknown>,
        Date.now(),
      ),
    ).toMatchObject({ ok: false, reason: 'stale' });
    const result = await history.fetch(
      time,
      time + 6,
      new AbortController().signal,
    );
    expect(result.map((t) => t.eventId)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
    ]);
    expect(result.map((t) => t.eventTime)).toEqual(rows.map((t) => t.t));
  });
  it('fails closed on unavailable history and supports cancellation', async () => {
    mock.setHistoryUnavailable(true);
    await expect(
      history.fetch(Date.now() - 10, Date.now(), new AbortController().signal),
    ).rejects.toThrow('history_http_503');
    const abort = new AbortController();
    abort.abort();
    await expect(
      history.fetch(Date.now() - 10, Date.now(), abort.signal),
    ).rejects.toThrow();
  });
  it('rejects a repeated cursor instead of looping or accepting an incomplete interval', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ trades: { QQQ: [] }, next_page_token: 'same' }),
          ),
      );
    await expect(
      history.fetch(Date.now() - 10, Date.now(), new AbortController().signal),
    ).rejects.toThrow('history_invalid_cursor');
  });
  it('does not follow redirects with credentials or expose HTTP response secrets', async () => {
    const request = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () => new Response('sensitive provider body', { status: 403 }),
      );
    await expect(
      history.fetch(Date.now() - 10, Date.now(), new AbortController().signal),
    ).rejects.toThrow('history_http_403');
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });
  it('accepts an explicitly empty trade set but rejects malformed responses', async () => {
    const request = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ trades: null, next_page_token: null })),
      );
    await expect(
      history.fetch(Date.now() - 10, Date.now(), new AbortController().signal),
    ).resolves.toEqual([]);
    request.mockImplementation(async () => new Response('{}'));
    await expect(
      history.fetch(Date.now() - 10, Date.now(), new AbortController().signal),
    ).rejects.toThrow('history_invalid_response');
  });
});
