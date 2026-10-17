# Entrega de Diego — sprints 2 y 3

Revisión de asignaciones en ClickUp: 17 de octubre de 2026. Responsable confirmado: **Diego Alejandro Ocampo Madroñero**.

## Tareas asignadas y resultado

| Sprint | Tarea | Puntos / rol | Entrega local |
| --- | --- | --- | --- |
| 2 | [Implementar stop-loss dinámico por velocidad de caída](https://app.clickup.com/t/90171539493/86e390zb9) | 8 / Tech Lead–DevOps | Motor, integración con ingesta, publicación de solicitud y pruebas. |
| 3 | [Ejecutar pruebas E2E con broker mock](https://app.clickup.com/t/90171539493/86e390zch) | 5 / QA | Suite repetible con bróker HTTP local y cliente móvil simulado mediante Socket.IO. |
| 3 | [Auditar cifrado TLS 1.3 y AES-256](https://app.clickup.com/t/90171539493/86e390zck) | 3 / QA | Auditoría ejecutada, evidencia JSON y hallazgos con remediación. Dictamen: **NO APROBADO**. |

La integración FIX/API corresponde a Dylan y los servicios push/FCM a otros integrantes, según el tablero consultado. Los resultados de esta entrega no certifican esas implementaciones ni la app Flutter con FCM. No se cambiaron estados ni listas de control en ClickUp.

## Sprint 2: política de stop-loss

Se calcula la velocidad entre dos precios consecutivos del mismo símbolo:

`caída_por_minuto = ((precio_anterior - precio_actual) / precio_anterior) × 100 × 60000 / diferencia_ms`.

Es una tasa normalizada por minuto entre observaciones consecutivas, no una vela ni un promedio móvil. Esta elección permite reaccionar al último descenso; una serie muy ruidosa puede producir tasas altas y requiere calibración de estrategia antes de ejecutar operaciones reales.

| Velocidad de caída | Política | Espera desde la detección |
| --- | --- | --- |
| Mayor que 0 y menor que 0,1 %/min | SLOW | 5 minutos |
| De 0,1 a 0,5 %/min, ambos incluidos | INTERMEDIATE | 1 minuto |
| Mayor que 0,5 %/min | FAST | Sin espera deliberada |

El rango intermedio es una decisión de implementación, porque el backlog exige documentarlo y no fija su duración. Una tolerancia de `1e-10` puntos porcentuales evita que ruido de coma flotante cambie la clasificación en los límites.

Los ticks repetidos no aplazan el vencimiento. Una caída más rápida puede anticiparlo. La recuperación hasta el precio previo a la primera caída cancela la espera y permite armar un nuevo episodio. Se emite una sola solicitud por episodio. Una caída menor seguida de estabilidad por debajo de ese precio conserva el vencimiento.

Se exige continuidad y frescura de hasta 2 segundos. Un hueco mayor, un timestamp futuro o una invalidación de ingesta elimina la decisión pendiente. La desconexión no ejecuta órdenes utilizando el último precio conocido. Los ticks históricos de recuperación no activan este motor. Precios no positivos/no finitos y timestamps repetidos o retrocedidos no generan solicitudes.

`MarketAtrConsumer` entrega al stop-loss únicamente ticks aceptados en la caché y procesados por el análisis. `StopLossService` los copia a una cola acotada de 4.096 elementos y retorna sin esperar red ni órdenes. Trabaja mediante `setImmediate` en lotes de 128, con un temporizador de 100 ms para vencimientos. El desbordamiento cancela el estado pendiente y genera un aviso. Es aislamiento asíncrono dentro del proceso Node, no un proceso o worker de CPU independiente.

El evento `hedging_alert` contiene `action: STOP_LOSS_REQUEST`, `executionStatus: REQUESTED`, símbolo, precio, velocidad, política, identificador de correlación y timestamps. **Solicitar ejecución no significa que una orden haya sido enviada o llenada.** La conexión productiva con el bróker queda a cargo del conector pendiente. No se modificaron posiciones ni se enviaron operaciones financieras.

Archivos:

- `backend/src/modules/hedging/dynamic-stop-loss.ts`: máquina de estados testeable.
- `backend/src/modules/hedging/stop-loss.service.ts`: cola, temporizador y publicación.
- `backend/src/modules/hedging/hedging.module.ts`: registro NestJS.
- `backend/src/modules/market-data/market-atr.consumer.ts`: integración y cancelación al perder continuidad.
- `backend/src/modules/hedging/dynamic-stop-loss.spec.ts`: umbrales, límites, esperas, escalamiento, duplicados, frescura y ejecución diferida fuera de ingesta.

## Sprint 3: flujo E2E simulado

La prueba recorre el consumidor real de mercado, análisis real, servicio real de stop-loss y gateway NestJS/Socket.IO. La persistencia Redis y ATR se sustituyen por dobles de prueba: esta suite no verifica durabilidad ni cálculo ATR. El bróker es un servidor HTTP real de loopback, con respuestas controladas; el extremo móvil es un cliente Socket.IO que confirma recepción.

El adaptador `backend/src/testing/mock-order-flow.ts` es exclusivamente un contrato de prueba, admite solo HTTP en `127.0.0.1`, no se registra en el módulo productivo y rechaza redirecciones. La cantidad fija de una unidad y el lado `sell` son datos del escenario de prueba, no dimensionamiento de cartera ni estrategia aprobada.

| Caso | Verificación |
| --- | --- |
| Caída rápida | Solicitud → orden IOC → aceptación → notificación recibida y confirmada. |
| Rechazo definitivo | Una tentativa y notificación de rechazo. |
| Rechazo transitorio | Máximo dos tentativas con el mismo identificador; una sola aceptación. |
| Respuesta perdida tras aceptación | Consulta del estado por ID; no reenvío ciego de la orden. |
| Timeout sin reconciliación | Resultado `unknown`, sin afirmar aceptación y sin reenvío ciego. |
| Ausencia de dispositivo | Orden aceptada conservada y resultado `NO_DEVICE`. |
| Solicitud repetida | Una orden y una notificación por correlación en la sesión de prueba. |
| Recuperación histórica | Ninguna orden generada. |

Se comprueban símbolo, lado, cantidad, IOC, correlación y orden causal de timestamps. `accepted` significa aceptación del mock, no ejecución bursátil ni llenado IOC. No se atribuyen a esta suite mediciones de latencia de bróker real o entrega FCM. Para completar aceptación integrada de toda la épica deben reemplazarse estos adaptadores por el conector sandbox del equipo y el servicio push, y verificar un dispositivo Flutter.

## Auditoría de cifrado

Evidencia: [security-audit.json](../reportes/sprints-2-3/security-audit.json). La inspección no leyó el archivo privado `.env`, no exportó credenciales y no modificó infraestructura.

| Hallazgo | Severidad | Evidencia y remediación |
| --- | --- | --- |
| Entrada HTTP sin TLS explícito | Alta | `backend/src/main.ts` crea Nest sin HTTPS; no hay evidencia de proxy TLS en el repositorio. Configurar terminación TLS 1.3 confiable y verificar rechazo de HTTP externo y TLS 1.2. |
| PostgreSQL y Redis sin opciones TLS | Alta | `database.module.ts` y `redis-cache.service.ts`. Configurar cifrado y validación de CA/hostname en clientes y servidores; verificar negociación y rechazo de conexiones inseguras. |
| Cliente de mercado sin mínimo TLS 1.3 | Media | `market-data-ws.client.ts` no fija `minVersion`. Restringir clientes seguros y probar compatibilidad/rechazo. |
| Cifrado de volúmenes y backups no demostrado | Alta | Compose define volúmenes y AOF; no prueba AES-256. Obtener evidencia del volumen, snapshots, backups y gestión de claves. |
| Logs productivos y ciclo de claves no verificados | Media | No hay inventario de certificados, evidencia KMS ni archivo de logs productivos disponible. Auditar acceso, redacción, expiración y rotación sin extraer secretos. |

Se probó `ws.twelvedata.com:443` sin autenticación:

- TLS 1.3: conexión verificada, suite `TLS_AES_256_GCM_SHA384`.
- Certificado validado por Node; fecha de vencimiento reportada: 6 de diciembre de 2026, 07:01:08 UTC.
- TLS 1.2: **también aceptado**, con `ECDHE-ECDSA-AES128-GCM-SHA256`. La disponibilidad de TLS 1.3 no implica rechazo de versiones anteriores. No controlamos la configuración del proveedor.

El índice Git no contiene archivos privados `.env` y el escaneo heurístico de texto versionado no encontró coincidencias de secretos con sus patrones. Esto no certifica el historial Git, archivos externos, logs de ejecución ni todos los formatos posibles de credenciales. Los hallazgos del entorno local tampoco prueban por sí solos la configuración de un despliegue remoto desconocido.

**Conclusión de la auditoría:** realizada con hallazgos abiertos. No corresponde marcar como cumplidos TLS 1.3 en todas las conexiones ni AES-256 en reposo. Hacen falta configuración y evidencias del entorno de despliegue para aprobar esos criterios.

## Ejecución y evidencia

Desde `backend`:

```powershell
npm run test:sprints23 -- --json --outputFile=../reportes/sprints-2-3/tests.json
npm test -- --runInBand --cacheDirectory=.cache/jest --json --outputFile=../reportes/sprints-2-3/backend-tests.json
npm run lint
npm run build
npm run audit:security -- --host=ws.twelvedata.com --output=../reportes/sprints-2-3/security-audit.json
```

La auditoría genera informe aun cuando existen hallazgos. Agregar `--strict` devuelve código 1 si quedan fallos, revisiones o evidencias pendientes; errores de ejecución devuelven 2. El modo sin host realiza solo inspección local. El modo con host verifica certificados, TLS 1.3 y TLS 1.2 sin credenciales.

Resultados de esta entrega:

- 16 pruebas nuevas aprobadas en 2 suites.
- Suite completa tras integrar `origin/main` (`2292fe2`): 294 pruebas aprobadas, 12 omitidas de integración Redis/PostgreSQL, 27 suites aprobadas.
- Compilación y lint correctos.
- Auditoría: `NOT_APPROVED`, con evidencia del proveedor y remediaciones documentadas.

CI ejecuta las nuevas pruebas con la suite normal, guarda resultados JSON y publica la auditoría estática como artefacto. La auditoría es informativa y su ejecución correcta no equivale a un dictamen aprobado.

Las pruebas de red local necesitaron ejecución fuera de las restricciones de red del sandbox de esta sesión. No fue necesario instalar dependencias nuevas. Las modificaciones previas del repositorio se conservaron.
