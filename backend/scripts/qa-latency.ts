import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  DEFAULT_BENCHMARK,
  LatencyBenchmarkOptions,
  runLatencyBenchmark,
} from "../src/testing/latency-benchmark";

/**
 * Uso: npm run qa:latency -- --rate=200 --duration=30000 --batch=5 [--redis]
 * Con --redis usa REDIS_HOST/REDIS_PORT/REDIS_PASSWORD (por defecto el Redis de docker compose).
 * Escribe JSON y Markdown en reportes/latencia/ (raíz del repositorio).
 */
function option(name: string, fallback: number): number {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const value = Number(arg.slice(name.length + 3));
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} inválido`);
  return value;
}

const fmt = (value: number | null) => (value === null ? "—" : value.toFixed(3));

async function main() {
  const options: LatencyBenchmarkOptions = {
    ratePerSecond: option("rate", DEFAULT_BENCHMARK.ratePerSecond),
    durationMs: option("duration", 30_000),
    batchSize: option("batch", DEFAULT_BENCHMARK.batchSize),
    cache: process.argv.includes("--redis") ? "redis" : "memory",
  };
  const report = await runLatencyBenchmark(options);
  const dir = join(__dirname, "..", "..", "reportes", "latencia");
  mkdirSync(dir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const json = join(dir, `nfr-001_${stamp}.json`);
  writeFileSync(json, JSON.stringify(report, null, 2));

  const rows = Object.entries(report.result.segments)
    .map(
      ([segment, s]) =>
        `| ${segment} | ${s.count} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.max)} | ${fmt(s.average)} |`,
    )
    .join("\n");
  const markdown = `# NFR-001: latencia ingesta → hedging

- Fecha: ${report.generatedAt}
- Entorno: Node ${report.environment.node} · ${report.environment.platform}/${report.environment.arch}
- Veredicto: **${report.verdict}** (máximo total ${fmt(report.result.segments.total.max)} ms; presupuesto ${report.result.budgetMs} ms)
- Tramo más lento (p95): \`${report.result.slowestSegment ?? "—"}\`

## Configuración

| Parámetro | Valor |
| --- | --- |
| Ticks por segundo | ${options.ratePerSecond} |
| Duración | ${options.durationMs} ms |
| Ticks por frame | ${options.batchSize} |
| Caché | ${options.cache} |
| Camino medido | ${report.configuration.pipeline} |

Sustituciones: ${report.configuration.substitutes.join("; ")}.

## Datos

${report.data.ticksSent} ticks en ${report.data.framesSent} frames; entregados ${report.data.delivered}, medidos ${report.data.measured}, descartados ${report.data.dropped}. ${report.data.pattern}.

## Resultados (ms)

| Tramo | Muestras | p50 | p95 | Máximo | Promedio |
| --- | --- | --- | --- | --- | --- |
${rows}

Evidencia completa: \`${json.split(/[\\/]/).slice(-3).join("/")}\`.
`;
  writeFileSync(join(dir, `nfr-001_${stamp}.md`), markdown);
  console.log(markdown);
  process.exit(report.verdict === "PASS" ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
