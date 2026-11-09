# Integración de ramas para épica 3

Se integraron feature/connect-app-backend y feature/database-schema-entities en copi sobre main 086abe8. La primera ya contiene navegación y dashboard compartidos con feature/flutter-env-navigation y feature/hedging-monitoring-dashboard; no se duplicaron esas implementaciones.

Correcciones: historial HTTP consume el objeto samples del backend; Configuración permite comprobar conexión mediante el nuevo provider. Se preservan rutas de órdenes y Gemini, TLS y synchronize:false. Las seis entidades nuevas se registran mediante migración explícita; no reemplazan broker_orders ni conectan automáticamente las órdenes al broker.

Validación local: 447 pruebas backend aprobadas, 25 omitidas (integraciones opt-in); 82 pruebas Flutter aprobadas, 2 omitidas. Backend build y lint sin errores (3 advertencias previas). Migración up/down/up contrastada con metadatos en base PostgreSQL aislada, sin diferencias de esquema. Prueba de regresión del contrato samples incluida.

La migración requiere permiso de creación de uuid-ossp. Rollback elimina las tablas nuevas y sus datos: usar únicamente bajo procedimiento de recuperación aprobado. No ejecutar rollback en producción para probar.

No certifica IBKR paper, FCM en dispositivo, cifrado productivo ni cierre de épica. El modelo de usuarios importado no habilita autenticación ni modifica el alcance general de Gemini.
