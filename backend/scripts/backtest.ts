import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { backtest } from '../src/modules/backtesting/backtest';

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) throw new Error('Usage: ts-node scripts/backtest.ts dataset.json report.json');
const raw = readFileSync(input, 'utf8');
const dataset = JSON.parse(raw);
if (!dataset.provenance || typeof dataset.provenance.source !== 'string' ||
    typeof dataset.provenance.version !== 'string' || typeof dataset.provenance.synthetic !== 'boolean')
  throw new Error('Dataset requires provenance: source, version, synthetic');
const result = backtest(dataset.samples, dataset.config);
const from = new Date(result.from);
const endRequired = new Date(from); endRequired.setUTCFullYear(from.getUTCFullYear() + 2);
const report = { provenance: dataset.provenance,
  sha256: createHash('sha256').update(raw).digest('hex'),
  ...result, historicalAcceptance: dataset.provenance.synthetic || result.to < endRequired.getTime()
    ? 'NOT_DEMONSTRATED' : 'REQUIRES_SOURCE_AND_COVERAGE_REVIEW' };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ samples: result.samples, maximumDrawdownPercent: result.maximumDrawdownPercent,
  historicalAcceptance: report.historicalAcceptance }));
