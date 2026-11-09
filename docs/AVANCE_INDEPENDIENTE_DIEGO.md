# Avance independiente de Diego — 8 de noviembre de 2026

## Cambios implementados

- PostgreSQL y Redis admiten TLS 1.3 con verificación de certificado. En `NODE_ENV=production` la aplicación exige `DB_TLS_ENABLED=true` y `REDIS_TLS_ENABLED=true`; no realiza fallback a texto plano. En desarrollo/test se conserva la conexión local sin TLS si no se activa expresamente.
- Los WebSockets `wss:` del proveedor exigen TLS 1.3 y verificación del certificado. Los mocks locales `ws:` conservan su transporte de pruebas. Un proveedor sin TLS 1.3 ya no conecta: no bajar el mínimo para ocultar el problema.
- El informe de backtesting añade comparación con comprar y mantener, capital final, comisiones, costo de slippage y cantidad abierta. Ambas estrategias usan los mismos costos de entrada; las posiciones abiertas se valoran al precio observado y no se inventa una venta final. La diferencia de retornos se expresa en puntos porcentuales.
- La auditoría estática reconoce las rutas TLS y mantiene su dictamen NO APROBADO hasta verificar infraestructura y evidencias. Encontrar código TLS no demuestra una conexión cifrada efectiva.

## Configuración para recibir el ambiente

Configurar hosts y puertos reales de PostgreSQL y Redis, además de:

```dotenv
NODE_ENV=production
DB_TLS_ENABLED=true
REDIS_TLS_ENABLED=true
DB_TLS_CA_FILE=/ruta/fuera/del/repositorio/ca-postgres.pem
REDIS_TLS_CA_FILE=/ruta/fuera/del/repositorio/ca-redis.pem
```

Las rutas CA son opcionales cuando el certificado está firmado por una CA confiable para Node. Nunca usar `rejectUnauthorized=false` ni `NODE_TLS_REJECT_UNAUTHORIZED=0`. Los archivos deben ser PEM válidos y accesibles al proceso; los errores no muestran su contenido. El código de clientes no configura TLS en los servidores ni cifra discos o backups. Docker Compose local sigue siendo de desarrollo y no proporciona TLS.

Referencia de la política de cliente: [opciones TLS de Node.js](https://nodejs.org/api/tls.html#tlsconnectoptions-callback).

## Validación reproducible

Desde `backend`: `npm run qa:diego -- ../reportes/avance-diego-local`.

Incluye pruebas del motor, backtesting, integración mock, política TLS, cliente de mercado, lint y build. La suite del cliente comprueba las opciones enviadas al transporte; no certifica el handshake de los endpoints productivos. Revisar `summary.json` y los logs; `toolsPassed` no equivale a seguridad ni aceptación histórica aprobadas.

La evidencia de esta revisión se guarda en [avance-diego-verificado](../reportes/avance-diego-verificado/summary.json). Las ocho suites contienen 80 pruebas. Las pruebas HTTP/WebSocket requieren permiso para abrir y conectar puertos locales; ejecutarlas en un entorno que permita loopback.

El escenario sintético de 601 observaciones conserva un retorno/drawdown de −10,359281 %; comprar y mantener obtiene −10,179730 % con valoración de la posición abierta. La diferencia es −0,179551 puntos porcentuales y refleja, entre otros efectos, los costos de salida de la estrategia que liquidó. Son resultados del fixture, no del histórico pendiente.

## Lo que todavía impide cerrar las dos historias

**Seguridad:** endpoint HTTPS/WSS de entrada, certificados/CA y servidores de datos configurados, prueba de handshake y rechazo de versiones antiguas, cifrado de volúmenes y backups, gestión de claves y revisión de logs del despliegue. Juan José entrega el ambiente; Diego vuelve a auditarlo.

**Backtesting:** dataset intradía licenciado de 24 meses, calendario/cobertura revisados, estrategia completa de cobertura y reentrada, y aceptación del límite de pérdida y política intermedia. El evaluador sigue siendo una liquidación de posición larga, carga JSON/curvas en memoria y no sustituye la estrategia pendiente de Dylan. La comparación nueva no implica mejora de rentabilidad. El histórico y sus responsables deben acordarse con el coordinador.

No se modifican los estados de ClickUp ni se certifica una entrega productiva por estas comprobaciones locales.
