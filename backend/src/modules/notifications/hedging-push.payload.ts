import type { StopLossTrigger } from '../hedging/dynamic-stop-loss';

export const HEDGING_PUSH_SCHEMA_VERSION = '1';

/**
 * Payload `data` de FCM: todos los valores deben ser strings. La app valida
 * `schemaVersion` y descarta versiones que no conoce.
 */
export interface HedgingPushData {
  readonly [key: string]: string;
  readonly schemaVersion: typeof HEDGING_PUSH_SCHEMA_VERSION;
  readonly type: 'HEDGING_ACTIVATED';
  readonly correlationId: string;
  readonly symbol: string;
  readonly policy: StopLossTrigger['policy'];
  readonly action: StopLossTrigger['action'];
  readonly price: string;
  readonly fallPercentPerMinute: string;
  readonly triggeredAtMs: string;
  /** Ruta interna de la app: detalle de la orden asociada a la activación. */
  readonly route: string;
}

export interface PushMessage {
  readonly title: string;
  readonly body: string;
  readonly data: HedgingPushData;
}

const POLICY_LABEL: Record<StopLossTrigger['policy'], string> = {
  SLOW: 'caída lenta',
  INTERMEDIATE: 'caída intermedia',
  FAST: 'caída rápida',
};

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
