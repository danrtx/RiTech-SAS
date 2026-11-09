# Sprint 3 — Envío IOC a IBKR y reintentos controlados

**Rol:** Backend Developer · **Story points:** 8

Como Backend Developer, quiero enviar órdenes limitadas IOC a una cuenta paper de Interactive Brokers mediante su API REST, gestionar sus respuestas y reintentar exclusivamente rechazos por limitación de solicitudes, para ejecutar coberturas con trazabilidad y sin reenvíos automáticos ante resultados inciertos.

## Alcance implementado

- `BrokerModule` exporta `IocExecutionService.execute` y `refresh` para consumo interno. El comando `npm run broker:ioc -- <correlationId> <conid> <BUY|SELL> <cantidad> <precioLimite>` permite enviar una orden explícita desde `backend/`.
- API Client Portal Gateway local por HTTPS; sesión y MFA administradas por IBKR. Se comprueba autenticación, conexión y pertenencia de la cuenta `DU...` configurada antes del envío. TLS se verifica; no hay credenciales en código ni respuestas crudas en auditoría.
- Se envían `LMT`, `tif=IOC`, cantidad entera positiva, precio límite y `cOID` estable. Solo opera con `EXECUTION_MODE=ibkr-paper`.
- Estados: aceptada, ejecución completa/parcial, rechazada, expirada, cancelada, confirmación requerida y resultado desconocido. Una cancelación IOC no implica necesariamente cero ejecución; no se infieren cantidades ejecutadas. `refresh(clientId)` consulta el estado del broker sin reenviar.
- Máximo tres intentos por orden, espera exponencial de al menos 1 y 2 segundos, respetando `Retry-After`. Si exige más de 30 segundos se detiene. Solo HTTP 429 habilita reintento; no se reintentan rechazos comerciales, advertencias, errores 5xx ni fallos de red.
- PostgreSQL reclama la clave mediante una restricción única antes del envío. El mismo identificador con otro contenido se rechaza. Cada intento y resultado se registra transaccionalmente en `broker_order_events`, sin textos arbitrarios del proveedor.

## Criterios y evidencia

| Criterio | Implementación / verificación |
| --- | --- |
| IOC al sandbox | Adaptador REST y comando de envío. Pendiente prueba con sesión paper real del usuario. |
| Aceptadas, rechazadas, expiradas y red | Pruebas del adaptador con respuestas controladas y reconciliación de estado. |
| Reintentos limitados sin duplicación | Pruebas de concurrencia, nueva instancia del servicio, conflicto de contenido, 429 y límite de intentos. Persistencia respaldada por clave única SQL. |
| Credenciales externas y trazas | Sesión externa en Gateway, HTTPS y tablas de órdenes/eventos. |

## Validación en cuenta paper

1. Iniciar PostgreSQL y el Client Portal Gateway oficial; iniciar sesión en la cuenta **paper** mediante su interfaz y completar MFA.
2. Configurar localmente `EXECUTION_MODE=ibkr-paper`, `IBKR_PAPER_ACCOUNT=DU...` y `IBKR_GATEWAY_URL=https://localhost:5000/v1/api`. Agregar la CA/certificado del Gateway al almacén de confianza mediante `NODE_EXTRA_CA_CERTS`; nunca desactivar verificación TLS.
3. Desde `backend/`, ejecutar el comando anterior con contrato, lado, cantidad y precio elegidos para la prueba. No reutilizar la correlación para una cobertura diferente. El comando aplica las migraciones registradas al iniciar.
4. Conservar el `clientId` y `brokerOrderId` emitidos; revisar la orden en IBKR y consultar `broker_order_events` ordenado por `id`. Invocar `refresh(clientId)` desde el servicio interno para actualizar el estado posterior.
5. Repetir exactamente la solicitud: debe devolver el registro existente sin un segundo POST. Adjuntar evidencia de la cuenta paper para cerrar el primer criterio.

## Límites operativos

La simulación `EXECUTION_MODE=paper` existente se conserva. El disparador de stop loss no proporciona contrato IBKR, tamaño de posición ni lado de cobertura; por eso no se conecta automáticamente a este servicio. El consumidor debe aportar esos datos explícitamente. No se expone un endpoint HTTP de trading sin autenticación.

Un proceso que muere después de guardar la intención puede dejar `SUBMITTING`; una respuesta perdida deja `UNKNOWN`. No se reenvían esas órdenes. Si hay ID del broker, consultar estado; si no lo hay, reconciliar manualmente por `cOID` en IBKR antes de tomar otra acción. No borrar registros para forzar reintentos. Se prioriza evitar duplicados sobre reanudar automáticamente una operación incierta. La deduplicación requiere conservar la base de datos y la misma correlación; no constituye una garantía de ejecución exactamente una vez del broker.

Las advertencias de IBKR requieren revisión manual; no se confirman automáticamente. No hay polling de estados en segundo plano ni cálculo de remanentes parciales. Los reintentos se limitan por orden; el broker puede aplicar límites globales adicionales.

Referencia oficial: [IBKR Web API](https://www.interactivebrokers.com/campus/ibkr-api-page/webapi-doc/) y [cuentas paper](https://www.interactivebrokers.com/campus/glossary-terms/paper-trading-account/).

## Verificación local — 2026-11-08

- `npm run build`: aprobado.
- `npm test -- --runInBand broker`: 23 pruebas aprobadas.
- `npm test -- --runInBand --forceExit --silent`: 356 aprobadas, 12 omitidas; 36 suites aprobadas y 2 omitidas. Se usó `--forceExit` por recursos abiertos al terminar la suite.
- ESLint sobre el módulo y la migración: sin errores; tres advertencias por tipos `any` en dobles de prueba.
- PostgreSQL no estuvo disponible en el puerto local 5433: la migración y las transacciones no se validaron contra una instancia real en esta sesión.
- No se realizó un envío externo a IBKR ni se comprobó una sesión autenticada del Gateway. El criterio de sandbox sigue pendiente de evidencia.
