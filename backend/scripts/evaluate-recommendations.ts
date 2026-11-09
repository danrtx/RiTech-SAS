import { readFileSync, statSync } from "node:fs";
import { evaluateRecommendations } from "../src/modules/investment/recommendation-backtest";
try {
  const [dataset, signals] = process.argv.slice(2);
  if (
    !dataset ||
    !signals ||
    statSync(dataset).size > 32 * 1024 * 1024 ||
    statSync(signals).size > 16 * 1024 * 1024
  )
    throw new Error();
  console.log(
    JSON.stringify(
      evaluateRecommendations(
        readFileSync(dataset, "utf8"),
        readFileSync(signals, "utf8"),
      ),
      null,
      2,
    ),
  );
} catch {
  console.error(
    "Evaluation failed: provide valid QQQ dataset and timestamped recorded recommendations with separate training/evaluation periods.",
  );
  process.exitCode = 1;
}
