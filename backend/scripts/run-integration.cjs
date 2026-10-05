const { spawnSync } = require("node:child_process");
const result = spawnSync(
  process.execPath,
  [
    require.resolve("jest/bin/jest"),
    "--runInBand",
    "--testRegex",
    ".*\\.integration\\.spec\\.ts$",
    ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
    env: { ...process.env, RUN_REDIS_TESTS: "1" },
  },
);
process.exit(result.status ?? 1);
