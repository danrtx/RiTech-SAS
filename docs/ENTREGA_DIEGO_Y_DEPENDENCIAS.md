# Entrega de Diego y solicitudes al equipo

Revisión: 8 de noviembre de 2026. Rama local: `copi`. Base de integración: `1eecb43`, con `main` hasta `38c1554`.

Este documento utiliza las asignaciones registradas en [sprints 2–3](ENTREGA_DIEGO_SPRINTS_2_3.md), el [sprint 4](ESTADO_SPRINT_4.md) y el código de las ramas descargadas. No sustituye el tablero actualizado. Los autores de commits sirven para identificar trabajo, no para atribuir tareas que no tienen responsable confirmado. No se enviaron mensajes ni se cambiaron estados del tablero.

## Lo que puedes entregar ahora

| Actividad | Entrega disponible | Qué significa su estado |
| --- | --- | --- |
| Stop-loss dinámico — `86e390zb9` | Motor, cola, invalidación por desconexión/huecos, publicación de solicitud, integración con latencia/push/paper y pruebas. | Implementación local lista para revisión. Falta la aceptación del criterio intermedio de 1 minuto; no afirma ejecución de órdenes externas. |
| E2E con bróker mock — `86e390zch` | Ocho escenarios de aceptación, rechazo, reintento, respuesta perdida, timeout, ausencia de dispositivo, duplicados y recuperación histórica. | El alcance explícito de la tarea es mock. Su entrega no depende del conector real. La aceptación externa de la épica es un trabajo posterior. |
| Auditoría TLS/AES — `86e390zck` | Inspección estática y negociación pública TLS actualizadas, hallazgos y plan de verificación. | Auditoría realizada con dictamen `NOT_APPROVED`. Corregir los hallazgos y aprobar la seguridad del despliegue no son lo mismo que ejecutar la auditoría. |
| Estrés/backtesting — `86e390ze6` | Evaluador, validación de archivos externos, identificación de proxy, informe de discontinuidades, huella SHA-256 y pruebas. | Herramientas listas para recibir datos. La historia de 24 meses y la estrategia completa permanecen pendientes. |

La evidencia nueva está en [el resumen reproducible](../reportes/entrega-diego-2026-11-08/summary.json), [pruebas](../reportes/entrega-diego-2026-11-08/tests.json), [recepción del dataset](../reportes/entrega-diego-2026-11-08/dataset-validation.json), [backtesting](../reportes/entrega-diego-2026-11-08/backtest.json) y [auditoría con TLS público](../reportes/entrega-diego-2026-11-08/security-audit.json). La evidencia previa de Flutter, PostgreSQL y Redis está en [integración](../reportes/integracion-2026-11-08/smoke.json).

Resultado de esta entrega: **36 pruebas aprobadas en seis suites**, lint y compilación correctos. Se verificaron además [cinco casos del comando de entrada](../reportes/entrega-diego-2026-11-08/cli-checks.json): protección del mismo archivo, alias de mayúsculas y enlace duro; rechazo de entrada inválida sin producir reporte; creación de la carpeta de salida. El benchmark sintético conserva un drawdown de **-10,3592810786 %**, fuera del límite del 2 %; no se presenta como cumplimiento histórico.

## Reproducir tu entrega

Desde `backend`, con las dependencias instaladas:

```powershell
npm run qa:diego -- ../reportes/entrega-diego-local
```

El comando crea la carpeta, ejecuta las seis suites de tus entregas, lint, compilación, validación del dataset, benchmark y auditoría estática. Guarda un log por paso y `summary.json`. Falla si una herramienta falla. **`toolsPassed: true` no equivale a seguridad aprobada ni a backtesting histórico completado**: consultar también `securityVerdict` e `historicalAcceptance`.

No necesita PostgreSQL, Redis ni credenciales; la prueba E2E abre servidores HTTP/Socket.IO locales. El benchmark usa el archivo sintético existente para verificar reproducibilidad, sin presentarlo como histórico. La auditoría pública es opcional y separada:

```powershell
npm run audit:security -- --host=ws.twelvedata.com --output=../reportes/entrega-diego-local/security-audit.json
```

Para recibir datos reales, seguir [el contrato de recepción](RECEPCION_HISTORICO_BACKTESTING.md). El motor no se cambió para forzar un drawdown objetivo.

## Qué pedir a cada integrante

Solicitar en todas las entregas: PR/commit exacto, instrucciones de ejecución, evidencia reproducible y fecha estimada. Los accesos se comparten por el mecanismo seguro del equipo, no dentro del repositorio.

### Dylan — conector del bróker

Mensaje preparado:

> Para validar mi stop-loss contra el bróker necesito el PR del conector FIX/API, un ambiente de pruebas del proveedor accesible y el contrato de envío/consulta de órdenes. Incluye cómo relacionar `correlationId` con la orden, estados de aceptación/ejecución parcial/ejecución total/rechazo/cancelación y cómo consultar después de un timeout sin duplicar. Indica símbolo negociable, unidades, restricciones de cantidad y quién define el tamaño de la orden. Necesito instrucciones, evidencia y fecha de entrega; no hace falta habilitar operaciones con dinero real.

Se considera recibido cuando puede enviarse una orden de prueba, consultar su estado por identificador y reconciliar una respuesta perdida; aceptación no debe etiquetarse como ejecución completada. La señal NDX o QQQ no determina por sí sola el instrumento de cobertura.

Desbloquea: E2E externo y adaptación de la solicitud stop-loss al contrato definitivo. **No bloquea tu E2E con mock ya entregable.** La implementación FIX/API se atribuye a Dylan por la asignación documentada, no solo por los commits.

### Juan José — persistencia y aplicación

Mensaje preparado:

> Necesito integrar las entregas de `feature/database-schema-entities`, `feature/connect-app-backend` y `feature/hedging-monitoring-dashboard`. Comparte los PRs definitivos y confirma qué ramas se solapan para no incorporarlas dos veces. Para órdenes/posiciones necesito migraciones y servicios que guarden y consulten el estado, correlación única y recuperación después de reiniciar. Para la app, necesito los contratos de API, pantallas conectadas y estados claros de solicitado, aceptado, ejecutado, rechazado y simulado. Incluye pasos de arranque, pruebas y fecha estimada.

Se considera recibido cuando la operación conserva su identidad y estado al reiniciar el backend, puede consultarse por correlación y la interfaz refleja lo que devuelve el backend sin inventar fills. Las entidades solas no demuestran persistencia operativa. Los nombres de ramas y la autoría son evidencia del trabajo encontrado; confirmar la responsabilidad de los servicios y migraciones en el tablero.

Desbloquea: validación de trazabilidad, reinicios y aceptación sobre la interfaz final. No impide probar hoy el motor, la telemetría actual ni el benchmark.

### Danilo — FCM y evidencia operativa

Mensaje preparado:

> El código de FCM ya está integrado. Para reproducir el recorrido completo necesito las instrucciones y configuración del ambiente Firebase, un build identificado de la app y un dispositivo registrado. Comparte la evidencia existente de Android y los pasos para comprobar recepción en primer plano, segundo plano y arranque desde una notificación. Debemos verificar que el enlace abre la misma correlación y que una solicitud de stop-loss no se presenta como una orden ejecutada. Confirma las plataformas incluidas y cuándo podemos repetir la prueba.

Se considera recibido cuando se reproduce envío/recepción y navegación sobre el mismo backend y commit. Si iOS forma parte de la aceptación, confirmar también APNs, firma y dispositivo; no atribuirle la validación iOS a la prueba Android. La evidencia de latencia existente puede reutilizarse dentro de su alcance, sin confundir tiempo hasta decisión con latencia de bróker o entrega push.

Desbloquea: verificación externa de notificaciones. No hay que esperar una reimplementación de FCM.

### Responsable de infraestructura — confirmar nombre en el tablero

Mensaje preparado:

> Para cerrar la verificación de seguridad necesito el ambiente de despliegue y su commit, endpoints HTTPS/WSS, configuración de terminación TLS y conexión a PostgreSQL/Redis. También evidencias de cifrado de volúmenes, snapshots y backups, políticas de acceso/rotación de claves e inventario de certificados. Incluye una prueba de restauración y logs redactados. Confirma quién atiende cada hallazgo y la fecha de remediación; no necesito exportar claves privadas ni credenciales.

Desbloquea: reinspección y dictamen del despliegue. La tarea de contenerizar/desplegar figura como `86e390ze5`; su responsable no está confirmado en las fuentes revisadas. No asignarla automáticamente a Danilo ni a otro integrante. Si el responsable eres tú, es trabajo propio adicional, no una espera externa.

### Responsable del histórico y quien acepta la estrategia — confirmar nombres

Mensaje preparado:

> Necesito identificar quién entrega el histórico intradía licenciado de 24 meses y quién aprueba la estrategia. Los datos deben indicar fuente, versión, instrumento, UTC, frecuencia, calendario de sesiones y huecos conocidos. Confirmen si se exige NDX o se acepta QQQ como proxy. Para el modelo necesito posiciones iniciales, dimensionamiento, instrumento de cobertura, reglas de entrada/reentrada, costos/slippage y criterio de aceptación del drawdown. Confirmen además la espera intermedia del stop-loss de 1 minuto. El texto “menor a -2 %” debe aclararse: el evaluador actual interpreta un límite de pérdida del 2 % como drawdown firmado mayor o igual a -2 %.

Desbloquea: evaluación histórica de la estrategia final y aprobación de los criterios ambiguos. Un gráfico en vivo o velas diarias no reemplazan el histórico intradía requerido. No se encontró una asignación nominal verificable para estas entregas; pedir al coordinador que la confirme.

## Plan de verificación al recibir dependencias

| Evidencia necesaria | Verificación que ejecutará Diego | Condición para aceptar |
| --- | --- | --- |
| Conector y persistencia | Envío, consulta, rechazo, timeout, reconciliación y reinicio | Misma correlación, ninguna duplicación y estados consistentes; nunca asumir fill por aceptación. |
| App y FCM del ambiente | Correlación en alerta, recepción y navegación con app abierta/cerrada | El dispositivo muestra el estado verdadero de la solicitud/orden. |
| Endpoint TLS | Certificado/hostname, negociación TLS 1.3 y rechazo de versiones fuera del requisito | Evidencia verificable del endpoint desplegado; una conexión exitosa por sí sola no demuestra rechazo de TLS 1.2. |
| PostgreSQL y Redis con TLS | Conexión verificada con CA y rechazo de acceso inseguro según configuración del despliegue | Cliente y servidor configurados y comprobados. |
| Almacenamiento y claves | Configuración efectiva de cifrado, permisos y rotación; restauración de backup | Evidencia del volumen y backup reales, sin publicar secretos. |
| Dataset y estrategia aprobados | Validar archivo, revisar cobertura por calendario y ejecutar modelo acordado | Fuente/licencia/cobertura verificadas; métricas reproducibles, incluyendo resultados que no cumplan el objetivo. |

La auditoría del 8 de noviembre sigue señalando entrada HTTP, opciones TLS de clientes y falta de evidencias de almacenamiento/claves. Twelve Data permitió TLS 1.3 y TLS 1.2; el certificado observado vence el 3 de febrero de 2027. Estos son resultados de esa ejecución, no garantías futuras.

## Textos para actualizar tus actividades

- **Stop-loss:** “Implementación local e integración listas para revisión, con pruebas de umbrales, continuidad y publicación. El evento representa una solicitud; la ejecución externa depende del conector del bróker. Pendiente confirmación del criterio intermedio.”
- **E2E mock:** “Escenarios del alcance con bróker mock ejecutados y evidenciados. La certificación con proveedor y dispositivo reales queda separada de esta entrega.”
- **Auditoría:** “Auditoría realizada y actualizada. Dictamen NO APROBADO por hallazgos y evidencias de despliegue pendientes; se entrega plan de remediación/verificación.”
- **Backtesting:** “Herramientas y contrato de datos preparados y probados. Pendientes histórico intradía de 24 meses, cobertura/fuente verificables y definición final de estrategia; no se afirma cumplimiento del drawdown.”

Son textos preparados para revisión humana; no implican cambios de estado en ClickUp/Jira.
