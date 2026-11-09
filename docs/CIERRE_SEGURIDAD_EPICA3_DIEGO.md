# Cierre de seguridad de la épica 3 — Diego

## Avance independiente del 9 de noviembre de 2026

Se agregó `backend/scripts/verify-tls-local.cjs`. Usa la función real
`datastoreTls` de la aplicación contra servidores TLS efímeros en loopback.
Para las políticas DB y REDIS verifica:

1. Conexión con CA confiable, nombre correcto y negociación TLS 1.3.
2. Rechazo de un servidor limitado a TLS 1.2.
3. Rechazo de certificado autofirmado no confiable.
4. Rechazo de nombre de servidor distinto al certificado.

Las ocho comprobaciones pasaron. Evidencia:
[tls-local.json](../reportes/epica3-diego-2026-11-09/tls-local.json).
Son conexiones TLS reales locales, no pruebas del protocolo de PostgreSQL/Redis
ni evidencia de cifrado del despliegue. No prueban FCM ni envío de órdenes.
La auditoría productiva permanece pendiente.

## Reproducir

Desde `backend`, con dependencias instaladas:

```sh
npm run qa:tls:local -- --output=../reportes/epica3-diego-local/tls-local.json
npm run audit:security -- --output=../reportes/epica3-diego-local/security-static.json --strict
```

Se requiere OpenSSL: en Windows se utiliza el incluido con Git; en otros sistemas,
el disponible en PATH. `OPENSSL_BIN` permite indicar otra instalación confiable.
Se requiere permiso para ejecutar OpenSSL y abrir puertos en 127.0.0.1.
Se genera un certificado de un día con clave temporal; se eliminan al terminar.
No se cambian certificados del sistema ni se leen credenciales privadas del proyecto.
El segundo comando debe devolver código 1 mientras existan hallazgos pendientes;
eso significa auditoría no aprobada, no fallo de la herramienta.

## Evidencias que pedir y validar

| Entrega | A quién pedirla | Qué comprobará Diego |
| --- | --- | --- |
| URL HTTPS/WSS del ambiente y versión desplegada | Juan José | Certificado válido para el host, TLS 1.3 y rechazo de versiones anteriores conforme al requisito; conexión Socket.IO y tratamiento de HTTP externo. |
| PostgreSQL y Redis con TLS, puertos, nombres y CA pública si es privada | Juan José con backend | Conexión desde la aplicación con validación activa; rechazo de CA incorrecta y de texto plano en el servidor. No pedir contraseñas por chat. |
| Evidencia de cifrado de discos, volúmenes, snapshots y backups | Juan José | Recurso/ambiente identificado, algoritmo AES-256 o equivalente aprobado, alcance, fecha y restauración probada. Un volumen Docker o AOF no demuestra cifrado. |
| Política de claves y muestra de logs redactada | Responsable de infraestructura/backend | Permisos, responsable, rotación y ausencia de claves/tokens/datos sensibles en logs. No adjuntar material privado. |
| Cuenta paper y flujo del broker integrado al stop-loss | Dylan / responsable del broker | Contrato, lado y cantidad explícitos; correlación entre señal y orden, resultado y ausencia de duplicados. Validar en ambiente paper autorizado. |
| Dispositivo y Firebase del ambiente | Danilo y responsable móvil | Recepción y apertura de notificación, identificador correlacionado con el evento y casos foreground/background. |

## Registro de aceptación pendiente

Para cada evidencia registrar responsable, fecha, ambiente, commit/imagen,
procedimiento, resultado esperado/observado y enlace a evidencia redactada.
Estados posibles: PASS, FAIL o NOT_VERIFIED; no convertir falta de evidencia en PASS.
Revisar el informe completo y las excepciones aceptadas antes de firmar la auditoría.
Las pruebas mock ya existentes siguen siendo evidencia de integración simulada;
no sustituyen la prueba final con broker paper y dispositivo.
