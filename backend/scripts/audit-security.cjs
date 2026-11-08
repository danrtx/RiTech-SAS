/* Read-only audit. Never prints secret values or reads the private .env file. */
const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const findings = [];
const add = (id, severity, status, evidence, remediation) => findings.push({ id, severity, status, evidence, remediation });

const main = read('backend/src/main.ts');
add('TLS-INBOUND', 'HIGH', /httpsOptions/.test(main) ? 'REVIEW' : 'FAIL',
  'backend/src/main.ts: NestFactory.create(AppModule); HTTP listener. No repository evidence of a TLS termination proxy.',
  'Configure a trusted TLS 1.3 endpoint for HTTP and Socket.IO, reject plaintext externally, verify certificate chain, hostname, expiry and TLS 1.2 refusal.');
const redis = read('backend/src/modules/redis-cache/redis-cache.service.ts');
const db = read('backend/src/modules/database/database.module.ts');
add('TLS-DATASTORES', 'HIGH', /tls:/.test(redis) && /ssl:/.test(db) ? 'REVIEW' : 'FAIL',
  'Redis client and TypeORM configuration inspected; explicit TLS options are absent in the current configuration.',
  'Enable verified TLS 1.3 for PostgreSQL and Redis; supply trusted CA material and test insecure connection refusal.');
const ws = read('backend/src/modules/market-data/market-data-ws.client.ts');
add('TLS-PROVIDER-MINIMUM', 'MEDIUM', /minVersion: ['"]TLSv1.3['"]/.test(ws) ? 'REVIEW' : 'FAIL',
  'Market WebSocket socket options inspected. wss alone does not enforce TLS 1.3.',
  'Set and test TLS 1.3 minimum on secure clients. Probe deployed destinations with certificate verification enabled.');
add('AES-AT-REST', 'HIGH', 'NOT_VERIFIED',
  'docker-compose.yml declares PostgreSQL and Redis named volumes and Redis AOF; no disk, volume or KMS encryption evidence is supplied.',
  'Provide deployment evidence of AES-256 or approved equivalent for volumes, snapshots and backups, including key ownership, access and rotation. AOF is not encryption.');

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const forbidden = tracked.filter(name => /(^|\/)\.env($|\.)/.test(name) && !name.endsWith('.example'));
add('SECRET-FILES', 'HIGH', forbidden.length ? 'FAIL' : 'PASS',
  forbidden.length ? forbidden : 'No private .env files appear in git ls-files (current index only).',
  'Keep credentials outside source control; rotate any exposed key and assess Git history separately.');
const candidates = [];
const patterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\b(?:ghp_|github_pat_|AKIA)[A-Za-z0-9_]{16,}\b/, /(?:api[_-]?key|secret|password)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{24,}["']/i];
for (const name of tracked) {
  if (!/\.(?:ts|js|cjs|json|ya?ml|md|log|dart)$/.test(name) || /package-lock|pubspec.lock|audit-security.cjs/.test(name)) continue;
  const full = path.join(root, name);
  if (!fs.existsSync(full) || fs.statSync(full).size > 2000000) continue;
  read(name).split(/\r?\n/).forEach((line, index) => {
    if (patterns.some(pattern => pattern.test(line))) candidates.push({ file: name, line: index + 1 });
  });
}
add('SECRET-SCAN', 'HIGH', candidates.length ? 'REVIEW' : 'PASS', candidates.length ? candidates :
  'No matches in the current tracked text files using the documented heuristic patterns; values are never included in this report.',
  'Review flagged locations locally. This heuristic cannot certify absence of secrets, sensitive runtime logs or historical leaks.');
add('RUNTIME-LOGS-AND-KEYS', 'MEDIUM', 'NOT_VERIFIED',
  'No production log archive, certificate inventory, KMS policy or rotation evidence is available in the workspace.',
  'Audit deployed logs and key lifecycle with redaction; collect certificate expiry and key rotation evidence without exporting secrets.');

async function probe(host, version) {
  return new Promise(resolve => {
    let done = false;
    const finish = result => { if (!done) { done = true; socket.destroy(); resolve(result); } };
    const socket = tls.connect({ host, port: 443, servername: host, minVersion: version, maxVersion: version, rejectUnauthorized: true }, () => {
      const certificate = socket.getPeerCertificate();
      finish({ host, requested: version, connected: true, negotiated: socket.getProtocol(), authorized: socket.authorized,
        cipher: socket.getCipher().name, certificateValidTo: certificate.valid_to });
    });
    socket.setTimeout(5000, () => finish({ host, requested: version, connected: false, reason: 'timeout' }));
    socket.once('error', error => finish({ host, requested: version, connected: false, reason: error.code ?? 'tls_error' }));
  });
}

(async () => {
  const hosts = process.argv.filter(arg => arg.startsWith('--host=')).map(arg => arg.slice(7));
  if (hosts.some(host => !/^[a-zA-Z0-9.-]+$/.test(host))) throw new Error('Use a hostname without credentials, port or URL path');
  const probes = [];
  for (const host of hosts) for (const version of ['TLSv1.3', 'TLSv1.2']) probes.push(await probe(host, version));
  const report = { auditedAt: new Date().toISOString(), scope: 'Current working tree configuration and tracked file names/text; optional public TLS handshakes',
    verdict: findings.some(f => f.status === 'FAIL' || f.status === 'NOT_VERIFIED' || f.status === 'REVIEW') ? 'NOT_APPROVED' : 'APPROVED',
    findings, probes, limitations: ['No production deployment certification', 'No private .env contents read', 'No Git history or runtime logs certification', 'A successful TLS 1.3 probe does not prove TLS 1.2 refusal'] };
  const output = process.argv.find(arg => arg.startsWith('--output='));
  const json = JSON.stringify(report, null, 2) + '\n';
  if (output) { const destination = path.resolve(output.slice(9)); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, json); }
  process.stdout.write(json);
  if (process.argv.includes('--strict') && report.verdict !== 'APPROVED') process.exitCode = 1;
})().catch(() => { process.stderr.write('Security audit failed; no sensitive details emitted.\n'); process.exitCode = 2; });
