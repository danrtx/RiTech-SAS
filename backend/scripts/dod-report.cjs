/**
 * Borrador del acta de Definition of Done a partir de evidencias ya generadas.
 * No ejecuta pruebas: consolida lo que produjeron CI o la ejecución local.
 *
 *   npm run test:cov -- --ci --json --outputFile=coverage/jest-results.json
 *   (cd ../frontend_mobile && flutter test --coverage --file-reporter=json:coverage/flutter-tests.json)
 *   npm run qa:latency -- --redis
 *   npm run qa:dod [-- --strict]
 *
 * Opciones: --backend-coverage=, --backend-tests=, --flutter-coverage=, --flutter-tests=,
 * --latency=, --security=, --output-dir=, --strict (código 1 si algún criterio no se cumple).
 * La decisión final y las excepciones las firma QA: el script nunca marca el acta como aprobada.
 */
const { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require("node:fs");
const { join, relative, resolve } = require("node:path");

/** Raíz del repositorio (este script vive en backend/scripts). */
const ROOT = resolve(__dirname, "..", "..");
// Umbrales de la DoD: cobertura de líneas > 80 % y latencia NFR-001 ≤ 200 ms.
const COVERAGE_TARGET = 80;
const LATENCY_BUDGET_MS = 200;

/** Ruta absoluta del argumento `--nombre=ruta`, o `fallback` si no se pasó. */
const arg = (name, fallback) => {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  return found ? resolve(found.slice(name.length + 3)) : fallback;
};
/** Contenido del archivo como texto, o null si no existe. */
const read = (path) => (path && existsSync(path) ? readFileSync(path, "utf8") : null);
/** Archivo JSON parseado, o null si no existe o está corrupto. */
const json = (path) => {
  const text = read(path);
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
};
/** Ruta relativa a la raíz con "/" (para que el acta se lea igual en Windows y Linux). */
const rel = (path) => (path ? relative(ROOT, path).replace(/\\/g, "/") : "—");

/** Último archivo de `dir` cuyo nombre cumple `pattern` (los nombres llevan la fecha, así que ordenar alcanza). */
function latest(dir, pattern) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((name) => pattern.test(name)).sort();
  return files.length ? join(dir, files.at(-1)) : null;
}

/** Porcentaje de líneas de un lcov.info (LH/LF). */
function lcovLines(text) {
  if (text === null) return null;
  let found = 0;
  let hit = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("LF:")) found += Number(line.slice(3));
    if (line.startsWith("LH:")) hit += Number(line.slice(3));
  }
  return found ? (hit / found) * 100 : null;
}

/** Reporte JSON de `flutter test --file-reporter json:`: una línea por evento. */
function flutterResults(text) {
  if (text === null) return null;
  let passed = 0;
  let failed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "testDone" && !event.hidden && event.skipped !== true)
        event.result === "success" ? passed++ : failed++;
    } catch {
      return null;
    }
  }
  return { passed, failed };
}

// Evidencias que consume el acta; cada una se puede sobrescribir por argumento.
const paths = {
  backendCoverage: arg("backend-coverage", join(ROOT, "backend/coverage/coverage-summary.json")),
  backendTests: arg("backend-tests", join(ROOT, "backend/coverage/jest-results.json")),
  flutterCoverage: arg("flutter-coverage", join(ROOT, "frontend_mobile/coverage/lcov.info")),
  flutterTests: arg("flutter-tests", join(ROOT, "frontend_mobile/coverage/flutter-tests.json")),
  latency: arg("latency", latest(join(ROOT, "reportes/latencia"), /^nfr-001_.*\.json$/)),
  security: arg("security", latest(join(ROOT, "reportes/sprints-2-3"), /^security-audit.*\.json$/)),
};

/** Criterios evaluados; cada uno termina en PASS, FAIL o MISSING (falta la evidencia). */
const checks = [];
const check = (id, criterion, status, evidence, detail) =>
  checks.push({ id, criterion, status, evidence: rel(evidence), detail });

// Criterio 1: cobertura de líneas en backend y app móvil.
const backendCov = json(paths.backendCoverage)?.total?.lines?.pct ?? null;
const flutterCov = lcovLines(read(paths.flutterCoverage));
for (const [id, label, value, path] of [
  ["COV-BACKEND", "Cobertura de líneas backend > 80 %", backendCov, paths.backendCoverage],
  ["COV-MOBILE", "Cobertura de líneas app móvil > 80 %", flutterCov, paths.flutterCoverage],
]) {
  check(
    id,
    label,
    value === null ? "MISSING" : value > COVERAGE_TARGET ? "PASS" : "FAIL",
    path,
    value === null ? "Sin reporte de cobertura" : `${value.toFixed(2)} % de líneas`,
  );
}

// Criterio 2: pruebas sin fallos (Jest en backend, flutter test en la app).
const jest = json(paths.backendTests);
check(
  "TEST-BACKEND",
  "Pruebas backend sin fallos",
  jest === null ? "MISSING" : jest.numFailedTests === 0 && jest.success ? "PASS" : "FAIL",
  paths.backendTests,
  jest === null
    ? "Sin resultados Jest (--json --outputFile)"
    : `${jest.numPassedTests} aprobadas, ${jest.numFailedTests} fallidas, ${jest.numPendingTests} omitidas`,
);

const flutter = flutterResults(read(paths.flutterTests));
check(
  "TEST-MOBILE",
  "Pruebas Flutter sin fallos",
  flutter === null ? "MISSING" : flutter.failed === 0 && flutter.passed > 0 ? "PASS" : "FAIL",
  paths.flutterTests,
  flutter === null
    ? "Sin reporte --file-reporter json"
    : `${flutter.passed} aprobadas, ${flutter.failed} fallidas`,
);

// Criterio 3: latencia bajo carga (último reporte de npm run qa:latency).
const latency = json(paths.latency);
const total = latency?.result?.segments?.total;
check(
  "NFR-001",
  `Latencia ingesta → hedging ≤ ${LATENCY_BUDGET_MS} ms bajo carga`,
  !total || total.count === 0
    ? "MISSING"
    : total.max <= LATENCY_BUDGET_MS && latency.data?.dropped === 0
      ? "PASS"
      : "FAIL",
  paths.latency,
  total
    ? `${latency.configuration.ratePerSecond} ticks/s, caché ${latency.configuration.cache}: p50 ${total.p50.toFixed(2)} ms, p95 ${total.p95.toFixed(2)} ms, máx ${total.max.toFixed(2)} ms, descartes ${latency.data.dropped}`
    : "Ejecutar npm run qa:latency -- --redis",
);

// Criterio 4: auditoría de cifrado TLS 1.3 / AES-256.
const security = json(paths.security);
check(
  "SEC-AUDIT",
  "Auditoría TLS 1.3 / AES-256 aprobada",
  security === null ? "MISSING" : security.verdict === "APPROVED" ? "PASS" : "FAIL",
  paths.security,
  security === null
    ? "Sin auditoría"
    : `Dictamen ${security.verdict}; ${security.findings.filter((f) => f.status !== "PASS").length} hallazgos abiertos`,
);

// Salida: el acta en JSON (para máquinas) y en Markdown (para firmar).
const generatedAt = new Date().toISOString();
const blocking = checks.filter((c) => c.status !== "PASS");
const outDir = arg("output-dir", join(ROOT, "reportes/dod"));
mkdirSync(outDir, { recursive: true });
const stamp = generatedAt.slice(0, 10);
const report = {
  generatedAt,
  target: { coveragePercent: COVERAGE_TARGET, latencyBudgetMs: LATENCY_BUDGET_MS },
  proposal: blocking.length ? "NO_CUMPLE" : "CUMPLE_PENDIENTE_FIRMA",
  checks,
};
writeFileSync(join(outDir, `acta-dod_${stamp}.json`), JSON.stringify(report, null, 2));

const icon = { PASS: "✅", FAIL: "❌", MISSING: "⚠️" };
const md = `# Acta de Definition of Done (borrador)

Generada: ${generatedAt} · Propuesta automática: **${report.proposal}**

| Id | Criterio | Estado | Detalle | Evidencia |
| --- | --- | --- | --- | --- |
${checks.map((c) => `| ${c.id} | ${c.criterion} | ${icon[c.status]} ${c.status} | ${c.detail} | \`${c.evidence}\` |`).join("\n")}

## Defectos abiertos

Consultar en ClickUp los defectos bloqueantes abiertos del release y listarlos aquí (el script no accede a ClickUp).

## Excepciones explícitas

${blocking.length ? blocking.map((c) => `- ${c.id}: _justificación, responsable y fecha de cierre_`).join("\n") : "- Ninguna"}

## Decisión

- [ ] Cumple · [ ] Cumple con excepciones · [ ] No cumple

Firma QA: ____________________ Fecha: __________
`;
writeFileSync(join(outDir, `acta-dod_${stamp}.md`), md);
console.log(md);
// Sin --strict siempre termina en 0: el acta es informativa y la decisión la toma QA.
process.exit(process.argv.includes("--strict") && blocking.length ? 1 : 0);
