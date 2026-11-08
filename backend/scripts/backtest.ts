import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { backtest } from "../src/modules/backtesting/backtest";
import { inspectDataset } from "../src/modules/backtesting/dataset";

try {
  const args = process.argv.slice(2);
  const validateOnly = args.includes("--validate-only");
  const paths = args.filter((arg) => arg !== "--validate-only");
  if (paths.length !== 2 || paths.some((arg) => arg.startsWith("--")))
    throw new Error(
      "Usage: npm run backtest -- dataset.json report.json [--validate-only]",
    );
  const [input, output] = paths;
  const canonical = (file: string) => {
    const resolved = existsSync(file) ? realpathSync(file) : resolve(file);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const sameInode =
    existsSync(input) &&
    existsSync(output) &&
    statSync(input).dev === statSync(output).dev &&
    statSync(input).ino === statSync(output).ino;
  if (canonical(input) === canonical(output) || sameInode)
    throw new Error("Input and output must be different files");
  const { dataset, report: quality } = inspectDataset(
    readFileSync(input, "utf8"),
  );
  const report = validateOnly
    ? quality
    : {
        ...backtest(dataset.samples, dataset.config),
        provenance: dataset.provenance,
        sha256: quality.sha256,
        historicalAcceptance: quality.historicalAcceptance,
        dataQuality: quality,
      };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      samples: quality.samples,
      historicalAcceptance: quality.historicalAcceptance,
      blockers: quality.blockers,
      output,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Backtest failed");
  process.exitCode = 1;
}
