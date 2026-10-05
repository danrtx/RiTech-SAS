/* Real Twelve Data → Nest → isolated Redis → HTTP/Socket.IO acceptance probe.
 * Run after npm run build, with node --env-file=../.env scripts/probe-twelve-live.cjs.
 * Requires QA_REDIS_PORT and QA_REDIS_PASSWORD for a disposable loopback Redis.
 * Does not import AppModule/PostgreSQL, place orders, or change provider settings.
 */
require('reflect-metadata');
const { randomUUID } = require('node:crypto');
const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const { performance } = require('node:perf_hooks');
const { Logger } = require('@nestjs/common');
const { ConfigModule } = require('@nestjs/config');
const { Test } = require('@nestjs/testing');
const { WebSocket } = require('ws');
const { io } = require('socket.io-client');
const { parseMarketDataConfig, MARKET_DATA_CONFIG } = require('../dist/modules/market-data/market-data.config');
const { MarketDataModule } = require('../dist/modules/market-data/market-data.module');
const { RedisCacheModule } = require('../dist/modules/redis-cache/redis-cache.module');
const { RedisCacheService } = require('../dist/modules/redis-cache/redis-cache.service');
const { MarketDataWsClient } = require('../dist/modules/market-data/market-data-ws.client');
const { AtrService } = require('../dist/modules/atr/atr.service');

const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(predicate, timeoutMs = 10000) {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) throw new Error('probe_wait_timeout');
    await delay(25);
  }
}
function stats(values) {
  if (!values.length) return { count: 0, min: null, max: null, average: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, min: sorted[0], max: sorted.at(-1),
    average: values.reduce((a, b) => a + b, 0) / values.length,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}

async function main() {
  Logger.overrideLogger(false);
  const report = { startedAt: new Date().toISOString(), outcome: 'INCOMPLETE',
    scope: 'Real QQQ WebSocket, actual market-data/ATR modules, disposable Redis, HTTP and Socket.IO; no PostgreSQL or deployment',
    states: [], prices: { received: 0, samples: [] }, heartbeatReplies: 0,
    dashboard: { ticks: 0, updates: 0, alerts: 0, qualityEvents: 0, atrEvents: 0, alertSamples: [] },
    controlledDisconnect: { attempted: false }, checks: {}, limitations: [
      'A short probe cannot validate sustained load, all failure modes, or complete ATR warm-up.',
      'The rule uses a short window and a small threshold solely to exercise delivery; it is not an investment recommendation.',
      'Age is measured against the local clock using the original provider timestamp; it includes timestamp precision and clock differences.',
    ] };
  const ages = [], afterCutAges = [], dashboardLatencies = [];
  let app, dashboard, sourceSocket, timer, cutAt, subscription, sourceStatus;
  const deadline = setTimeout(() => { console.error('probe_hard_timeout'); process.exit(2); }, 240000);
  const output = resolve(process.env.QA_REPORT_PATH || '../reportes/market_data/twelve_data_live_2026-10-05.json');
  try {
    const config = parseMarketDataConfig(process.env);
    if (!config.enabled || config.provider !== 'twelvedata' || config.feed !== 'realtime')
      throw new Error('probe_requires_real_twelve');
    const port = Number(process.env.QA_REDIS_PORT);
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || !process.env.QA_REDIS_PASSWORD)
      throw new Error('probe_requires_isolated_redis');
    report.configuration = { provider: config.provider, feed: config.feed, symbol: config.symbol,
      maxTickAgeMs: config.maxTickAgeMs, futureToleranceMs: config.futureToleranceMs,
      heartbeatMs: config.heartbeatMs, heartbeatTimeoutMs: config.heartbeatTimeoutMs };
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({
        marketData: config, REDIS_HOST: '127.0.0.1', REDIS_PORT: port,
        REDIS_PASS: process.env.QA_REDIS_PASSWORD, MOCK_FEED_URL: '',
        ATR_SYMBOLS: 'QQQ', TICK_KEY_PREFIX: `ritech:live-qa:${randomUUID()}`,
      })] }), RedisCacheModule, MarketDataModule,
    ] }).overrideProvider(MarketDataWsClient).useFactory({
      inject: [MARKET_DATA_CONFIG],
      factory: marketConfig => new MarketDataWsClient(marketConfig, (url, options) => {
      const socket = new WebSocket(url, options);
      sourceSocket = socket;
      socket.on('message', raw => {
        try {
          const event = JSON.parse(raw.toString());
          if (event.event === 'heartbeat' && event.status === 'ok') report.heartbeatReplies++;
          if (event.event !== 'price' || event.symbol !== config.symbol || !Number.isSafeInteger(event.timestamp)) return;
          const receivedAtMs = Date.now();
          const ageMs = receivedAtMs - event.timestamp * 1000;
          report.prices.received++; ages.push(ageMs);
          if (cutAt) afterCutAges.push(ageMs);
          if (report.prices.samples.length < 20) report.prices.samples.push({
            eventTimeMs: event.timestamp * 1000, receivedAtMs, ageMs,
            price: typeof event.price === 'number' ? event.price : null,
          });
        } catch { /* No raw provider text or authenticated URLs are retained. */ }
      });
      return socket;
      }),
    }).compile();
    app = module.createNestApplication();
    const client = app.get(MarketDataWsClient);
    subscription = client.status$.subscribe(status => {
      sourceStatus = status.state;
      report.states.push({ at: new Date().toISOString(), state: status.state,
        reason: status.lastError?.reason });
      if (cutAt && status.state === 'LIVE' && report.controlledDisconnect.reconnectedMs === undefined)
        report.controlledDisconnect.reconnectedMs = performance.now() - cutAt;
    });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const get = async path => {
      const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('probe_http_failed');
      return response.json();
    };
    report.initialStatus = await get('/market-data/status');
    if (sourceStatus !== 'LIVE') throw new Error('probe_subscription_failed');
    if (!sourceSocket) throw new Error('probe_observer_missing');
    dashboard = io(`${base}/telemetry`, { transports: ['websocket'], reconnection: false });
    let subscribed = false;
    dashboard.on('connect', () => dashboard.emit('subscribe_symbol', { symbol: config.symbol }));
    dashboard.on('subscribed', () => { subscribed = true; });
    dashboard.on('telemetry_tick', tick => {
      report.dashboard.ticks++;
      if (Number.isFinite(tick.receivedAtMs)) dashboardLatencies.push(Date.now() - tick.receivedAtMs);
    });
    dashboard.on('investment_update', () => report.dashboard.updates++);
    dashboard.on('price_alert', alert => {
      report.dashboard.alerts++;
      if (report.dashboard.alertSamples.length < 5) report.dashboard.alertSamples.push(alert);
    });
    dashboard.on('market_data_quality', () => report.dashboard.qualityEvents++);
    dashboard.on('atr_result', () => report.dashboard.atrEvents++);
    await until(() => subscribed);
    report.rule = { windowMs: 5000, upPercent: 0.000001, downPercent: 0.000001,
      thresholdBasis: 'INVESTMENT', investedAmount: 10000, cooldownMs: 0 };
    const rule = await fetch(`${base}/market-data/rules/live-qa`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report.rule) });
    if (rule.status !== 200) throw new Error('probe_rule_failed');
    console.log(JSON.stringify({ event: 'probe_observing', configuration: report.configuration, durationSeconds: 150 }));
    timer = setInterval(() => console.log(JSON.stringify({ event: 'probe_progress',
      prices: report.prices.received, dashboardTicks: report.dashboard.ticks,
      alerts: report.dashboard.alerts, ageMs: stats(ages), state: sourceStatus })), 30000);
    await delay(75000);
    report.beforeDisconnectStatus = await get('/market-data/status');
    if (sourceStatus === 'LIVE' && sourceSocket?.readyState === WebSocket.OPEN) {
      report.controlledDisconnect.attempted = true;
      cutAt = performance.now();
      sourceSocket.terminate();
      console.log(JSON.stringify({ event: 'probe_controlled_disconnect' }));
    }
    await delay(75000);
    report.finalStatus = await get('/market-data/status');
    report.history = await get('/market-data/history?limit=10');
    report.atr = app.get(AtrService).snapshot();
    report.persistedTicks = (await app.get(RedisCacheService).recoveryWindow(config.symbol)).length;
    const ingestion = report.finalStatus.ingestion;
    report.checks = {
      authenticatedAndSubscribed: report.states.some(s => s.state === 'LIVE'),
      receivedProviderPrices: report.prices.received > 0,
      deliveredFreshPrices: ingestion.delivered > 0,
      dashboardReceivedPrices: report.dashboard.ticks > 0,
      alertDelivered: report.dashboard.alerts > 0,
      ingestionLatencyUnder200ms: ingestion.receiptToConsumerLatencyMs.count > 0 && ingestion.receiptToConsumerLatencyMs.max < 200,
      reconnectUnder2s: report.controlledDisconnect.attempted && report.controlledDisconnect.reconnectedMs < 2000,
      validPricesAfterReconnect: ingestion.delivered > report.beforeDisconnectStatus.ingestion.delivered,
    };
    report.outcome = Object.values(report.checks).every(Boolean) ? 'PASS' : 'NOT_READY';
  } catch (error) {
    report.outcome = 'NOT_READY';
    report.error = error instanceof Error && /^probe_[a-z_]+$/.test(error.message)
      ? error.message : 'probe_execution_failed';
  } finally {
    clearInterval(timer);
    dashboard?.disconnect();
    try { await app?.close(); } catch { report.cleanupError = true; }
    subscription?.unsubscribe();
    clearTimeout(deadline);
    report.endedAt = new Date().toISOString();
    report.eventAgeMs = stats(ages);
    report.eventAgeAfterReconnectMs = stats(afterCutAges);
    report.receiptToDashboardMs = stats(dashboardLatencies);
    const serialized = JSON.stringify(report, null, 2);
    const secret = process.env.TWELVE_DATA_API_KEY?.trim();
    if (secret && serialized.includes(secret)) throw new Error('probe_report_redacted');
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, serialized + '\n');
    console.log(JSON.stringify({ event: 'probe_finished', outcome: report.outcome, checks: report.checks, report: output }));
    if (report.outcome !== 'PASS') process.exitCode = 1;
  }
}
main().catch(() => { console.error('probe_execution_failed'); process.exitCode = 2; });
