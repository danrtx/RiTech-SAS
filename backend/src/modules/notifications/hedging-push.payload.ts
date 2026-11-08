/**
 * Contrato del mensaje push que se envía cuando el stop-loss solicita una cobertura.
 * La app Flutter lo interpreta en `HedgingAlert.tryParse`: cualquier cambio de campos
 * debe ir acompañado de una nueva `schemaVersion` y de su soporte en la app.
 */
import type { StopLossTrigger } from '../hedging/dynamic-stop-loss';

/** Versión del contrato; la app descarta mensajes con una versión que no conoce. */
export const HEDGING_PUSH_SCHEMA_VERSION = '1';

/**
 * Payload `data` de FCM: todos los valores deben ser strings. La app valida
 * `schemaVersion` y descarta versiones que no conoce.
 */
export interface HedgingPushData {
  readonly [key: string]: string;
  readonly schemaVersion: typeof HEDGING_PUSH_SCHEMA_VERSION;
  readonly type: 'HEDGING_ACTIVATED';
  /** `SIMBOLO:eventTimeMs`; identifica el episodio y la orden asociada. */
  readonly correlationId: string;
  readonly symbol: string;
  /** SLOW, INTERMEDIATE o FAST, según la velocidad de caída. */
  readonly policy: StopLossTrigger['policy'];
  readonly action: StopLossTrigger['action'];
  /** Precio de activación en USD, como texto. */
  readonly price: string;
  /** Velocidad de caída en % por minuto, como texto. */
  readonly fallPercentPerMinute: string;
  /** Momento de la activación en milisegundos Unix (UTC), como texto. */
  readonly triggeredAtMs: string;
  /** Ruta interna de la app: detalle de la orden asociada a la activación. */
  readonly route: string;
}

/** Mensaje completo: título y cuerpo visibles en la bandeja, más los datos para la app. */
export interface PushMessage {
  readonly title: string;
  readonly body: string;
  readonly data: HedgingPushData;
}

/** Texto en español de cada política, para el cuerpo de la notificación. */
const POLICY_LABEL: Record<StopLossTrigger['policy'], string> = {
  SLOW: 'caída lenta',
  INTERMEDIATE: 'caída intermedia',
  FAST: 'caída rápida',
};

/** Convierte una activación del stop-loss en el mensaje push versionado. */
export function buildHedgingPushMessage(trigger: StopLossTrigger): PushMessage {
  const price = trigger.price.toFixed(2);
  return {
    title: `Hedging activado en ${trigger.symbol}`,
    body: `Stop-loss solicitado por ${POLICY_LABEL[trigger.policy]} (${trigger.fallPercentPerMinute.toFixed(2)} %/min) a ${price} USD.`,
    data: {
      schemaVersion: HEDGING_PUSH_SCHEMA_VERSION,
      type: 'HEDGING_ACTIVATED',
      correlationId: trigger.correlationId,
      symbol: trigger.symbol,
      policy: trigger.policy,
      action: trigger.action,
      price: String(trigger.price),
      fallPercentPerMinute: String(trigger.fallPercentPerMinute),
      triggeredAtMs: String(trigger.triggeredAtMs),
      route: `/orders/${encodeURIComponent(trigger.correlationId)}`,
    },
  };
}
