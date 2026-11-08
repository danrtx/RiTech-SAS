/**
 * Configuración de las notificaciones push (FCM), leída de variables de entorno FCM_*.
 * Se valida al arrancar: una configuración inválida detiene el backend con un mensaje claro
 * en lugar de fallar en silencio la primera vez que se active el hedging.
 */

/** Token de inyección de NestJS para la configuración ya validada. */
export const NOTIFICATIONS_CONFIG = Symbol('NOTIFICATIONS_CONFIG');

/** Ambiente derivado de NODE_ENV; define el tópico por defecto. */
export type PushEnvironment = 'development' | 'test' | 'production';

export interface NotificationsConfig {
  /** FCM_ENABLED. Si es false se usa DisabledPushSender y no se contacta a Google. */
  readonly enabled: boolean;
  readonly environment: PushEnvironment;
  /** Proyecto Firebase del ambiente; uno distinto por ambiente. */
  readonly projectId?: string;
  /**
   * Ruta al JSON de la cuenta de servicio. Si falta, se usan las Application Default
   * Credentials. La cuenta solo necesita el rol "Firebase Cloud Messaging API Admin".
   */
  readonly credentialsPath?: string;
  /** Tópico al que se suscriben los dispositivos registrados. */
  readonly topic: string;
  /** Tiempo máximo de espera por envío antes de darlo por fallido (por defecto 5 s). */
  readonly sendTimeoutMs: number;
  /** Alertas pendientes máximas en memoria; al superarla se descarta la más antigua. */
  readonly queueCapacity: number;
}

/** Subconjunto de process.env; recibirlo como parámetro facilita las pruebas. */
type Environment = Readonly<Record<string, string | undefined>>;

function invalid(variable: string, reason: string): never {
  // Nunca incluir el valor recibido: puede ser una ruta o identificador sensible.
  throw new Error(`Configuración de notificaciones inválida: ${variable} ${reason}`);
}

/** Lee un entero positivo dentro de [min, max]; si la variable no existe usa `fallback`. */
function boundedInteger(
  env: Environment,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) invalid(name, 'debe ser un entero positivo');
  const value = Number(raw);
  if (value < min || value > max) invalid(name, 'está fuera del rango permitido');
  return value;
}

/**
 * Valida y normaliza las variables FCM_*. Lanza un error si algo es inválido
 * (por ejemplo, FCM_ENABLED=true sin FCM_PROJECT_ID). El resultado es inmutable.
 */
export function parseNotificationsConfig(
  env: Environment = process.env,
): NotificationsConfig {
  const enabledValue = env.FCM_ENABLED?.trim() || 'false';
  if (enabledValue !== 'true' && enabledValue !== 'false')
    invalid('FCM_ENABLED', 'debe ser true o false');
  const enabled = enabledValue === 'true';

  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const environment: PushEnvironment =
    nodeEnv === 'production' ? 'production' : nodeEnv === 'test' ? 'test' : 'development';

  // Formato de ID de proyecto de Google Cloud: 6-30 caracteres, minúsculas, dígitos y guiones.
  const projectId = env.FCM_PROJECT_ID?.trim() || undefined;
  if (projectId && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId))
    invalid('FCM_PROJECT_ID', 'no es un identificador de proyecto Firebase válido');
  if (enabled && !projectId)
    invalid('FCM_PROJECT_ID', 'es obligatorio con FCM_ENABLED=true');

  const credentialsPath = env.FCM_CREDENTIALS_PATH?.trim() || undefined;
  if (credentialsPath && !credentialsPath.toLowerCase().endsWith('.json'))
    invalid('FCM_CREDENTIALS_PATH', 'debe apuntar a un archivo .json');

  // El sufijo de ambiente evita que un backend de pruebas alerte dispositivos productivos.
  const topic = env.FCM_TOPIC?.trim() || `hedging-alerts-${environment}`;
  // Caracteres que FCM admite en nombres de tópico.
  if (!/^[a-zA-Z0-9-_.~%]{1,900}$/.test(topic))
    invalid('FCM_TOPIC', 'contiene caracteres no permitidos por FCM');
  if (environment === 'production' && !topic.endsWith('-production'))
    invalid('FCM_TOPIC', 'en producción debe terminar en -production');

  return Object.freeze({
    enabled,
    environment,
    projectId,
    credentialsPath,
    topic,
    sendTimeoutMs: boundedInteger(env, 'FCM_SEND_TIMEOUT_MS', 5000, 100, 30000),
    queueCapacity: boundedInteger(env, 'FCM_QUEUE_CAPACITY', 256, 1, 10000),
  });
}
