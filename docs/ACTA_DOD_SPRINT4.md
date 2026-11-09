# Acta de Definition of Done — cierre del sprint 4

- **Proyecto:** RiTech SAS · cobertura de posiciones expuestas al NASDAQ 100
- **Versión evaluada:** `main` en el commit `c60a1ab` (PR #32), 9 de noviembre de 2026
- **Evidencia automática:** [ejecución del CI 42666001840](https://github.com/danrtx/RiTech-SAS/actions/runs/42666001840), trabajo *Definition of Done*
- **Responsable de QA:** Danilo Montezuma · tarea [Validar Definition of Done final](https://app.clickup.com/t/86e390ze1)
- **Estado del acta:** borrador para firma del equipo

## 1. Resultado de los criterios

### 1.1 Criterios de la tarea DoD

| Criterio | Resultado | Evidencia |
| --- | --- | --- |
| La cobertura supera el 80 % en SonarQube | **Cumple con excepción E1**: backend 81,00 % y app 82,70 % de líneas, medidas en el CI; SonarQube no está conectado | `backend/coverage/coverage-summary.json` y `frontend_mobile/coverage/lcov.info` del CI |
| Las pruebas críticas pasan sin defectos bloqueantes | **Cumple**: backend 540 aprobadas, 0 fallidas, 9 omitidas por condiciones de integración; app 101 aprobadas, 0 fallidas | `jest-results.json` y `flutter-tests.json` del CI |
| Las latencias permanecen estables bajo la carga definida | **Cumple**: 200 ticks/s con Redis real, p50 0,76 ms, p95 1,46 ms, máximo 12,06 ms, 0 descartes (presupuesto NFR-001: 200 ms) | Artefacto `latency-report` del CI; corrida previa en equipo de desarrollo: máximo 108 ms ([reporte](../reportes/latencia/nfr-001_2026-11-04T23-28-26-242Z.json)) |
| Se emite decisión con evidencias y excepciones explícitas | Este documento, sección 4 | — |

### 1.2 Criterios de la EPIC-004

| Criterio | Resultado | Responsable |
| --- | --- | --- |
| El backtesting demuestra un Maximum Drawdown menor a -2 % | **No demostrado (E3)**: el motor de backtesting es reproducible y está probado, pero no hay histórico intradía de 24 meses; el escenario sintético de estrés da −10,36 % | Diego |
| El uptime objetivo es 99,9 % | **No medido (E4)**: hay health checks y reinicio automático, pero no monitoreo continuo de disponibilidad | Juan José |
| La cobertura supera el 80 % | **Cumple** (ver 1.1) | Equipo |
| Las releases internas están publicadas | **Parcial (E5)**: APK de Android firmado con `scripts/build-apk.sh`; sin IPA de iOS ni TestFlight | Juan José |
| La arquitectura y la operación están documentadas | **Cumple, pendiente de aprobación**: ADR revisado, diagramas actualizados al 9 de noviembre y runbook con despliegue, rollback, recuperación e incidentes; falta la aprobación del ADR y la prueba guiada | Danilo |

### 1.3 Criterios heredados de sprints anteriores

| Criterio | Resultado | Responsable |
| --- | --- | --- |
| Auditoría de cifrado TLS 1.3 y AES-256 | **No aprobada (E2)**: el dictamen del CI es `NOT_APPROVED` con 6 hallazgos abiertos; la verificación TLS local pasó 8 de 8 comprobaciones | Diego |
| Alertas push en foreground, background y app cerrada | **Cumple en Android**: verificado en emulador Android API 36 el 7 de noviembre con FCM real; iOS sin verificar (E5) | Danilo |
| FCM configurado para desarrollo y pruebas | **Parcial (E6)**: existe el proyecto `ritech-sas-dev`; falta el de pruebas | Danilo |

## 2. Defectos y riesgos abiertos

No hay defectos bloqueantes en las pruebas automáticas. Hay tres riesgos de despliegue documentados en la sección 3.4 del [runbook](runbook.md):

| Id | Riesgo | Efecto | Responsable sugerido |
| --- | --- | --- | --- |
| R1 | `docker-compose.prod.yml` y `scripts/azure-deploy.sh` no activan TLS hacia PostgreSQL y Redis, y producción lo exige | El backend no arranca con `NODE_ENV=production` usando esos archivos | Juan José y Diego |
| R2 | `scripts/deploy.sh` busca una etiqueta `deploy.tag` que la imagen no tiene | El rollback automático no conoce la versión anterior; hay que indicarla a mano | Juan José |
| R3 | El despliegue en AWS con HTTPS ([PR #33](https://github.com/danrtx/RiTech-SAS/pull/33)) no está unido a `main` | El único despliegue validado con TLS 1.3 público no forma parte de la versión evaluada | Diego |

## 3. Estado del tablero

Tareas entregadas en código que siguen abiertas en ClickUp y que cada responsable debe actualizar:

| Tarea | Estado en ClickUp | Evidencia de entrega | Responsable |
| --- | --- | --- | --- |
| [Conectar la app móvil con el backend](https://app.clickup.com/t/86e390zcj) | to do | PR #28 (`feature/connect-app-backend`) | Juan José |
| [Desarrollar dashboard de monitoreo en Flutter](https://app.clickup.com/t/86e390zb5) | to do | Pantalla `/monitoring` en `main` | Juan José |
| [Probar motor de hedging con series sintéticas](https://app.clickup.com/t/86e390zb6) | to do | `hedging-synthetic.spec.ts` en `main` | Juan José |
| [Implementar y validar integración Gemini, recomendaciones y controles de riesgo](https://app.clickup.com/t/1dfvn9h7u8t) | to do | Módulo `investment` en `main` | Dylan |

La tarea *Implementar bitácora de auditoría regulatoria* ya no aparece en el tablero. Hay que confirmar si se descartó o se movió.

## 4. Excepciones explícitas

Cada excepción necesita la aceptación del equipo. Una excepción no aceptada se convierte en incumplimiento.

| Id | Excepción | Motivo | Cómo se cierra |
| --- | --- | --- | --- |
| E1 | Cobertura medida en el CI y no en SonarQube | El repositorio no tiene configurados los secretos `SONAR_TOKEN` y `SONAR_HOST_URL` | Agregar los secretos; el CI ya trae el paso de análisis y `sonar-project.properties` |
| E2 | Auditoría TLS/AES no aprobada | Faltan evidencias del ambiente desplegado: certificados, TLS en los almacenes, cifrado en disco y política de claves | Seguir la lista de evidencias de [CIERRE_SEGURIDAD_EPICA3_DIEGO.md](CIERRE_SEGURIDAD_EPICA3_DIEGO.md) |
| E3 | Maximum Drawdown no demostrado con 24 meses | No hay un histórico intradía licenciado de 24 meses; el criterio «menor a -2 %» necesita aclaración ([detalle](ENTREGA_DIEGO_Y_DEPENDENCIAS.md)) | Conseguir el dataset y aprobar la estrategia a evaluar |
| E4 | Uptime de 99,9 % no medido | No hay monitoreo continuo; los despliegues son de una instancia | Medir disponibilidad con un monitor externo durante un período acordado |
| E5 | iOS sin verificar (push y release) | El equipo no cuenta con Mac ni con una cuenta paga de Apple Developer | Verificar en una Mac con Xcode y publicar en TestFlight |
| E6 | Sin proyecto Firebase de pruebas | Solo se creó el de desarrollo | Crear `ritech-sas-test` siguiendo la sección 5 del runbook |

## 5. Decisión

Recomendación de QA: **cumple con excepciones**, siempre que el equipo acepte E1 a E6 y asigne R1 a R3 antes de cualquier despliegue a producción. Los criterios propios de la tarea DoD (pruebas, latencia y cobertura medida) se cumplen; los pendientes dependen de datos, hardware o ambientes externos al repositorio.

- [ ] Cumple
- [ ] Cumple con excepciones (E1 a E6 aceptadas)
- [ ] No cumple

| Rol | Nombre | Acepta las excepciones | Fecha |
| --- | --- | --- | --- |
| QA | Danilo Montezuma | | |
| Backend | Dylan Rodríguez | | |
| QA / Backend | Diego Ocampo | | |
| Mobile | Juan José Burbano | | |

## 6. Cómo regenerar la evidencia

El CI genera el borrador automático del acta en cada ejecución (resumen del trabajo *Definition of Done*). Para regenerarlo en local, desde `backend/`:

```bash
npm run test:cov -- --ci --json --outputFile=coverage/jest-results.json
npm run qa:latency -- --redis
(cd ../frontend_mobile && flutter test --coverage --file-reporter=json:coverage/flutter-tests.json)
npm run qa:dod
```
