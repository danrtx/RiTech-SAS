# Despliegue de demostración en AWS

EC2 en us-east-2 con PostgreSQL, Redis, NestJS y Flutter web. Acceso público HTTPS, sin usuario/contraseña HTTP, conforme a la configuración solicitada. El broker permanece deshabilitado; la cuenta de inversión es simulada.

## Uso

Requiere PowerShell 7, AWS CLI autenticada, Docker y Flutter. `provision.ps1` está limitado a la cuenta y red del despliegue actual; revisar sus identificadores antes de usar otra cuenta. No ejecutarlo de nuevo sobre recursos parcialmente creados: inspeccionar primero el estado en AWS.

1. Primera instalación: ejecutar `./infra/aws/provision.ps1`.
2. Configurar localmente `TWELVE_DATA_API_KEY` y `GEMINI_API_KEY` en `.env`.
3. Ejecutar `./infra/aws/release.ps1`. Compila el backend y frontend, publica artefactos privados y envía la instalación mediante SSM. Consultar la ejecución SSM usando el identificador generado: enviar el comando no significa que haya terminado correctamente.

El estado, claves generadas, artefactos y reportes se escriben en `../reportes/aws-deploy`, fuera del repositorio. Nunca agregar esa carpeta a Git. El archivo local `runtime.env` se conserva al repetir una publicación para no cambiar inadvertidamente las contraseñas de las bases de datos; actualizarlo explícitamente para rotar claves. La rotación de contraseñas requiere coordinar también PostgreSQL/Redis.

`bootstrap.sh` acepta el acuerdo de Let's Encrypt y registra el certificado de IP: debe ejecutarse únicamente con autorización del titular. Los certificados públicos de corta duración se renuevan mediante un temporizador systemd dos veces al día. Mantener el puerto 80 para ACME; la aplicación solo se sirve por HTTPS.

## Controles y límites

- TLS 1.3 público e interno; PostgreSQL, Redis y backend sin puertos publicados al exterior. EBS y S3 cifrados; secretos en Secrets Manager y rol de instancia con acceso limitado.
- Datos QQQ reales de Twelve Data y Gemini. Se mantiene la vigencia de precios de 2 segundos: estar conectado no garantiza datos recientes. Las velas cerradas permiten análisis informativo, sin habilitar órdenes.
- No hay login individual. Quien acceda a la URL puede utilizar las APIs expuestas; se conservan las cuotas existentes del agente.
- Certificados internos: 90 días, renovación manual. El temporizador renueva solo el certificado público.
- Demostración de una sola instancia, sin alta disponibilidad ni respaldo automático. Volúmenes persistentes no equivalen a backups.
- Una nueva publicación reinicia el backend y puede causar una interrupción breve. Revisar `/health`, la gráfica QQQ y el agente al terminar.
- Detener EC2 no elimina los cargos de disco e IP reservada. No terminar recursos sin revisar primero la persistencia de los datos.

No incorporar `.env`, `runtime.env`, certificados privados, archivos de acceso ni claves reales al repositorio o al PR.
