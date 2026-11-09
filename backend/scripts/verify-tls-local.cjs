/* Local TLS handshakes using the actual application policy. No external services. */
require('ts-node/register');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const assert = require('node:assert/strict');
const { execFileSync, execFile } = require('node:child_process');
const { datastoreTls } = require('../src/config/datastore-tls');
const { serverTls } = require('../src/config/server-tls');
const { Test } = require('@nestjs/testing');
const { io } = require('socket.io-client');
const { TelemetryGateway } = require('../src/modules/telemetry/telemetry.gateway');
const { MarketClock } = require('../src/modules/market-data/market.types');
const { AtrConfig } = require('../src/modules/atr/atr.config');

const results = [];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ritech-tls-'));
const ca = path.join(directory, 'certificate.pem');
const key = path.join(directory, 'key.pem');
const openssl = process.env.OPENSSL_BIN || (process.platform === 'win32'
  ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl');

async function handshake(policy, version, serverOptions) {
  const sockets = new Set();
  const server = tls.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(ca),
    minVersion: version, maxVersion: version, ...serverOptions });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('secureConnection', socket => socket.end());
  server.on('tlsClientError', () => {});
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    return await new Promise(resolve => {
      const socket = tls.connect({ host: '127.0.0.1', port: server.address().port, ...policy });
      const finish = result => { socket.destroy(); resolve(result); };
      socket.once('secureConnect', () => finish({ connected: true,
        authorized: socket.authorized, protocol: socket.getProtocol() }));
      socket.once('error', error => finish({ connected: false, code: error.code }));
      socket.setTimeout(5000, () => finish({ connected: false, code: 'TIMEOUT' }));
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', ca, '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore', timeout: 30000 });
  // Exercise native fetch in a fresh production-style process, not a mocked client.
  for (const version of ['TLSv1.3', 'TLSv1.2']) {
    const server = require('node:https').createServer({ key: fs.readFileSync(key),
      cert: fs.readFileSync(ca), minVersion: version, maxVersion: version },
    (_, response) => response.end('ok'));
    server.on('tlsClientError', () => {});
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const url = `https://127.0.0.1:${server.address().port}`;
      const script = `fetch(${JSON.stringify(url)}, { signal: AbortSignal.timeout(5000) }).then(r => r.text()).then(() => process.stdout.write('accepted')).catch(() => process.stdout.write('rejected'))`;
      const output = await new Promise((resolve, reject) => execFile(process.execPath,
        ['--tls-min-v1.3', '-e', script],
        { env: { ...process.env, NODE_EXTRA_CA_CERTS: ca }, timeout: 10000 },
        (error, stdout) => error ? reject(error) : resolve(stdout)));
      assert.equal(output, version === 'TLSv1.3' ? 'accepted' : 'rejected');
      results.push({ prefix: 'HTTP-CLIENT', scenario: version, passed: true });
      if (version === 'TLSv1.3') {
        for (const host of ['localhost', 'wrong.invalid']) {
          const exitCode = await new Promise(resolve => execFile(process.execPath,
            ['--tls-min-v1.3', path.join(__dirname, 'healthcheck.cjs')],
            { env: { ...process.env, PORT: String(server.address().port),
              SERVER_TLS_HEALTH_CA_FILE: ca, SERVER_TLS_HEALTH_HOST: host }, timeout: 10000 },
            error => resolve(error ? error.code : 0)));
          assert.equal(exitCode, host === 'localhost' ? 0 : 1);
          results.push({ prefix: 'HEALTHCHECK', scenario: host, passed: true });
        }
      }
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
  for (const prefix of ['DB', 'REDIS']) {
    for (const scenario of ['trusted', 'old-protocol', 'untrusted', 'wrong-host']) {
      const env = { NODE_ENV: 'production', [`${prefix}_TLS_ENABLED`]: 'true',
        [`${prefix}_HOST`]: scenario === 'wrong-host' ? 'wrong.invalid' : 'localhost',
        ...(scenario === 'untrusted' ? {} : { [`${prefix}_TLS_CA_FILE`]: ca }) };
      const result = await handshake(datastoreTls(name => env[name], prefix),
        scenario === 'old-protocol' ? 'TLSv1.2' : 'TLSv1.3');
      if (scenario === 'trusted') {
        assert.deepEqual(result, { connected: true, authorized: true, protocol: 'TLSv1.3' });
      } else {
        assert.equal(result.connected, false);
        const expected = scenario === 'old-protocol' ? ['ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION']
          : scenario === 'wrong-host' ? ['ERR_TLS_CERT_ALTNAME_INVALID']
          : ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'];
        assert.ok(expected.includes(result.code), `Unexpected failure for ${prefix}/${scenario}: ${result.code}`);
      }
      results.push({ prefix, scenario, passed: true, ...result });
    }
  }
  const env = { NODE_ENV: 'production', SERVER_TLS_ENABLED: 'true',
    SERVER_TLS_CERT_FILE: ca, SERVER_TLS_KEY_FILE: key };
  const serverOptions = serverTls(name => env[name]);
  for (const scenario of ['trusted', 'old-protocol', 'untrusted', 'wrong-host']) {
    const version = scenario === 'old-protocol' ? 'TLSv1.2' : 'TLSv1.3';
    const result = await handshake({ minVersion: version, maxVersion: version,
      rejectUnauthorized: true, servername: scenario === 'wrong-host' ? 'wrong.invalid' : 'localhost',
      ...(scenario === 'untrusted' ? {} : { ca: fs.readFileSync(ca) }) }, 'TLSv1.3', serverOptions);
    if (scenario === 'trusted') {
      assert.deepEqual(result, { connected: true, authorized: true, protocol: 'TLSv1.3' });
    } else {
      assert.equal(result.connected, false);
      const expected = scenario === 'old-protocol' ? ['ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION']
        : scenario === 'wrong-host' ? ['ERR_TLS_CERT_ALTNAME_INVALID']
        : ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'];
      assert.ok(expected.includes(result.code), `Unexpected failure for SERVER/${scenario}: ${result.code}`);
    }
    results.push({ prefix: 'SERVER', scenario, passed: true, ...result });
  }
  // Exercise the real Nest adapter and telemetry gateway over the same HTTPS listener.
  const module = await Test.createTestingModule({ providers: [TelemetryGateway,
    { provide: MarketClock, useValue: { now: () => Date.now() } },
    { provide: AtrConfig, useValue: { options: { symbols: ['QQQ'] } } },
  ] }).compile();
  const app = module.createNestApplication({ httpsOptions: serverOptions, logger: false });
  let client;
  try {
    await app.listen(0, '127.0.0.1');
    const port = app.getHttpServer().address().port;
    const response = await new Promise((resolve, reject) => {
      const request = require('node:https').get({ hostname: '127.0.0.1', port,
        servername: 'localhost', ca: fs.readFileSync(ca), minVersion: 'TLSv1.3',
        rejectUnauthorized: true }, res => {
        const protocol = res.socket.getProtocol();
        res.resume();
        resolve({ status: res.statusCode, protocol });
      });
      request.once('error', reject);
      request.setTimeout(5000, () => request.destroy(new Error('HTTPS timeout')));
    });
    assert.deepEqual(response, { status: 404, protocol: 'TLSv1.3' });
    results.push({ prefix: 'APP', scenario: 'https-listener', passed: true, ...response });
    const plaintextRejected = await new Promise(resolve => {
      const request = require('node:http').get({ hostname: '127.0.0.1', port }, res => {
        res.resume(); resolve(false);
      });
      request.once('error', error => resolve(error.code === 'ECONNRESET'));
      request.setTimeout(5000, () => { resolve(false); request.destroy(); });
    });
    assert.equal(plaintextRejected, true);
    results.push({ prefix: 'APP', scenario: 'plaintext-rejected', passed: true });
    client = io(`https://127.0.0.1:${port}/telemetry`, { transports: ['websocket'],
      autoConnect: false, reconnection: false, timeout: 5000, rejectUnauthorized: true,
      ca: fs.readFileSync(ca), transportOptions: { websocket: { servername: 'localhost', minVersion: 'TLSv1.3' } } });
    const ack = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WSS timeout')), 6000);
      client.once('connection_ack', value => { clearTimeout(timeout); resolve(value); });
      client.once('connect_error', error => { clearTimeout(timeout); reject(error); });
      client.connect();
    });
    assert.equal(ack.status, 'connected');
    results.push({ prefix: 'APP', scenario: 'telemetry-wss', passed: true });
  } finally {
    client?.disconnect();
    await app.close();
  }
})().catch(error => {
  results.push({ passed: false, code: error.code || 'VERIFICATION_FAILED' });
  process.exitCode = 1;
}).finally(() => {
  // Only remove the unique temporary directory created by this process.
  fs.rmSync(directory, { recursive: true, force: true });
  const report = { generatedAt: new Date().toISOString(),
    scope: 'Local TLS policies, Nest HTTPS listener and actual telemetry WSS gateway; not PostgreSQL/Redis protocol integration or production certification',
    passed: results.length === 19 && results.every(item => item.passed), results };
  const output = process.argv.find(arg => arg.startsWith('--output='));
  if (output) {
    const destination = path.resolve(output.slice(9));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
});
