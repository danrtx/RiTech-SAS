/* Local TLS handshakes using the actual application policy. No external services. */
require('ts-node/register');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { datastoreTls } = require('../src/config/datastore-tls');

const results = [];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ritech-tls-'));
const ca = path.join(directory, 'certificate.pem');
const key = path.join(directory, 'key.pem');
const openssl = process.env.OPENSSL_BIN || (process.platform === 'win32'
  ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl');

async function handshake(policy, version) {
  const sockets = new Set();
  const server = tls.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(ca),
    minVersion: version, maxVersion: version });
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
    '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore', timeout: 30000 });
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
})().catch(error => {
  results.push({ passed: false, code: error.code || 'VERIFICATION_FAILED' });
  process.exitCode = 1;
}).finally(() => {
  // Only remove the unique temporary directory created by this process.
  fs.rmSync(directory, { recursive: true, force: true });
  const report = { generatedAt: new Date().toISOString(),
    scope: 'Local TLS servers and actual datastoreTls policy; not PostgreSQL/Redis protocol integration or production certification',
    passed: results.length === 8 && results.every(item => item.passed), results };
  const output = process.argv.find(arg => arg.startsWith('--output='));
  if (output) {
    const destination = path.resolve(output.slice(9));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
});
