export const NOTIFICATIONS_CONFIG = Symbol('NOTIFICATIONS_CONFIG');

export type PushEnvironment = 'development' | 'test' | 'production';

export interface NotificationsConfig {
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
  readonly sendTimeoutMs: number;
  readonly queueCapacity: number;
}

type Environment = Readonly<Record<string, string | undefined>>;

function invalid(variable: string, reason: string): never {
  // Nunca incluir el valor recibido: puede ser una ruta o identificador sensible.
  throw new Error(`Configuración de notificaciones inválida: ${variable} ${reason}`);
}

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
