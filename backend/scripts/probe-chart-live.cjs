/* Read-only acceptance probe. It never creates alert rules or injects fake prices. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { writeFileSync, mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const { io } = require('socket.io-client');

function backend(value) {
  const url = new URL(value);
  assert(['http:', 'https:'].includes(url.protocol));
  assert(!url.username && !url.password && !url.search && !url.hash);
  return url.origin;
}
const base = backend(process.env.CHART_PROBE_URL || 'http://localhost:3000');
async function get(path, origin = base) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, 'backend_request_failed');
  return response.json();
}
const fingerprint = candles => createHash('sha256').update(JSON.stringify(candles.map(c =>
  [c.startTimeMs, c.open, c.high, c.low, c.close, c.volume]))).digest('hex');

async function main() {
  const snapshot = await get('/market-data/chart');
  assert.equal(snapshot.provider, 'twelvedata');
  assert.equal(snapshot.symbol, 'QQQ');
  assert(snapshot.candles.length > 0, 'no_chart_data_available');
  snapshot.candles.forEach((c, index, candles) => {
    assert(c.low > 0 && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close));
    assert(index === 0 || c.startTimeMs > candles[index - 1].startTimeMs);
    assert.equal(c.date, snapshot.date);
  });
  const historicDate = snapshot.availableDates.find(date => date < snapshot.today);
  const historic = historicDate ? await get(`/market-data/chart?date=${historicDate}`) : null;
  const reload = historicDate ? await get(`/market-data/chart?date=${historicDate}`) : null;
  if (historic) assert.equal(fingerprint(historic.candles), fingerprint(reload.candles));
  let independentPersistence = null;
  if (process.env.CHART_ARCHIVE_URL && historic) {
    const origin = backend(process.env.CHART_ARCHIVE_URL);
    const offline = await get(`/market-data/chart?date=${historicDate}`, origin);
    const status = await get('/market-data/status', origin);
    assert.equal(status.connection.state, 'DISABLED');
    assert.equal(offline.storage.history.state, 'disabled');
    assert.equal(fingerprint(offline.candles), fingerprint(historic.candles));
    independentPersistence = true;
  }
  const candle = await new Promise(resolve => {
    const socket = io(`${base}/telemetry`, { transports: ['websocket'], autoConnect: false, reconnection: false });
    const timer = setTimeout(() => { socket.disconnect(); resolve(null); }, 30000);
    socket.on('connect', () => socket.emit('subscribe_symbol', { symbol: 'QQQ' }));
    socket.on('chart_candle', value => { clearTimeout(timer); socket.disconnect(); resolve(value); });
    socket.connect();
  });
  let livePersisted = null;
  if (candle) {
    assert.equal(candle.symbol, 'QQQ');
    const after = await get(`/market-data/chart?date=${candle.date}`);
    const stored = after.candles.find(c => c.startTimeMs === candle.startTimeMs);
    assert(stored && stored.updatedAtMs >= candle.updatedAtMs, 'websocket_event_missing_in_database');
    livePersisted = true;
  }
  if (process.argv.includes('--require-live')) assert(candle, 'no_live_candle_observed_within_30_seconds');
  const result = {
    checkedAt: new Date().toISOString(), provider: snapshot.provider, symbol: snapshot.symbol,
    data: 'real_provider', session: snapshot.date, bars: snapshot.candles.length,
    historicalSession: historicDate ?? null, historicalBars: historic?.candles.length ?? 0,
    historicalFingerprint: historic ? fingerprint(historic.candles) : null,
    historicalReloadIdentical: historic ? true : null, independentBackendWithProviderDisabled: independentPersistence,
    liveCandleObserved: !!candle, liveCandleAlreadyPersisted: livePersisted,
    historyImport: snapshot.storage.history.state,
  };
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length);
  if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n'); }
  console.log(JSON.stringify(result, null, 2));
}
main().catch(() => { console.error('Chart acceptance probe failed; check /health and /market-data/chart.'); process.exitCode = 1; });
