/* Reproduce Diego's local deliverables without credentials or external services. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const backend = path.resolve(__dirname, '..');
const output = path.resolve(backend, process.argv[2] ?? '../reportes/entrega-diego-local');
fs.mkdirSync(output, { recursive: true });
const executable = (pkg, file) => path.join(path.dirname(require.resolve(`${pkg}/package.json`)), file);
const dataset = path.resolve(backend, '../reportes/sprint-4/synthetic-stress.json');
const steps = [
  ['tests', [require.resolve('jest/bin/jest'), '--runInBand', '--cacheDirectory=.cache/jest', '--json',
    `--outputFile=${path.join(output, 'tests.json')}`, 'dynamic-stop-loss', 'hedging-flow.e2e', 'paper-execution', 'hedging-integration', 'backtesting', 'datastore-tls', 'market-data-ws.client']],
  ['lint', [executable('eslint', 'bin/eslint.js'), '{src,test}/**/*.ts']],
  ['build', [executable('@nestjs/cli', 'bin/nest.js'), 'build']],
  ['dataset-validation', [executable('ts-node', 'dist/bin.js'), 'scripts/backtest.ts', '--validate-only', dataset, path.join(output, 'dataset-validation.json')]],
  ['backtest', [executable('ts-node', 'dist/bin.js'), 'scripts/backtest.ts', dataset, path.join(output, 'backtest.json')]],
  ['security-static', ['scripts/audit-security.cjs', `--output=${path.join(output, 'security-static.json')}`]],
];
const results = [];
for (const [name, args] of steps) {
  console.log(`Running ${name}...`);
  const run = spawnSync(process.execPath, args, {
    cwd: backend, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(output, `${name}.log`), (run.stdout ?? '') + (run.stderr ?? ''));
  results.push({ name, exitCode: run.status, error: run.error?.code ?? null });
  console.log(`${name}: ${run.status === 0 ? 'PASS' : 'FAIL'}`);
}
const succeeded = name => results.find(step => step.name === name)?.exitCode === 0;
const readResult = (step, file) => succeeded(step) ? JSON.parse(fs.readFileSync(path.join(output, file), 'utf8')) : null;
const tests = readResult('tests', 'tests.json');
const audit = readResult('security-static', 'security-static.json');
const historical = readResult('backtest', 'backtest.json');
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: backend, encoding: 'utf8' });
const summary = {
  generatedAt: new Date().toISOString(), baseCommit: revision.status === 0 ? revision.stdout.trim() : null,
  scope: 'Current working tree; local stop-loss, mock-broker E2E, paper integration, backtesting tooling, lint/build and static audit. No external broker or physical device certification.',
  steps: results, toolsPassed: results.every(step => step.exitCode === 0),
  tests: tests ? { passed: tests.numPassedTests, failed: tests.numFailedTests, suites: tests.numPassedTestSuites } : null,
  securityVerdict: audit?.verdict ?? 'NOT_RUN',
  historicalAcceptance: historical?.historicalAcceptance ?? 'NOT_RUN',
  maximumDrawdownPercent: historical?.maximumDrawdownPercent ?? null,
};
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
if (!summary.toolsPassed) process.exitCode = 1;
