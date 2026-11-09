import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { StopLossTrigger } from '../hedging/dynamic-stop-loss';
import { buildHedgingPushMessage, PushMessage } from './hedging-push.payload';
import { NOTIFICATIONS_CONFIG, NotificationsConfig } from './notifications.config';
import { PUSH_SENDER, PushSender } from './push-sender';

/**
 * Cola de alertas push del hedging. El stop-loss solo encola (operación síncrona e
 * inmediata) y esta clase hace los envíos a FCM en segundo plano, de a uno, con timeout.
 * Así una caída o lentitud de FCM nunca retrasa ni detiene las decisiones de trading.
 */

/** Respuesta de GET /notifications/status. */
export interface PushDeliveryStatus {
  readonly sender: PushSender['kind'];
  readonly topic: string;
  /** Alertas esperando envío en este momento. */
  readonly queued: number;
  /** Envíos aceptados por FCM desde el arranque. */
  readonly sent: number;
  /** Envíos rechazados o vencidos por timeout. */
  readonly failed: number;
  /** Alertas descartadas por cola llena o por apagado del backend. */
  readonly dropped: number;
  readonly lastError: { readonly code: string; readonly atMs: number } | null;
}

/** Valor con el que se rechaza la promesa cuando FCM no responde a tiempo. */
const TIMEOUT = 'fcm_timeout';

/** Errores de FCM como código estable; nunca se registra el token ni el mensaje completo. */
function errorCode(error: unknown): string {
  if (error === TIMEOUT) return TIMEOUT;
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && /^[a-z0-9/_.-]{1,80}$/i.test(code)) return code;
  const message = (error as Error)?.message;
  return typeof message === 'string' && /^[a-z0-9_]{1,80}$/.test(message) ? message : 'fcm_error';
}

@Injectable()
export class PushNotificationService implements OnModuleDestroy {
  private readonly logger = new Logger(PushNotificationService.name);
  private queue: PushMessage[] = [];
  /** true mientras un ciclo de envío recorre la cola (evita dos ciclos simultáneos). */
  private draining = false;
  /** true tras apagar el módulo: no se aceptan ni envían más alertas. */
  private stopped = false;
  private sent = 0;
  private failed = 0;
  private dropped = 0;
  private lastError: PushDeliveryStatus['lastError'] = null;

  constructor(
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: NotificationsConfig,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  /** Síncrono y sin excepciones: el llamador (motor de hedging) nunca espera a FCM. */
  notifyHedgingActivated(trigger: StopLossTrigger): void {
    if (this.stopped) return;
    try {
      if (this.queue.length >= this.config.queueCapacity) {
        // Se descarta la más antigua: la alerta más reciente refleja el estado actual.
        this.queue.shift();
        this.dropped++;
        this.logger.warn(JSON.stringify({ event: 'push_queue_overflow' }));
      }
      this.queue.push(buildHedgingPushMessage(trigger));
      // setImmediate: el envío empieza después de que el motor termine su trabajo actual.
      if (!this.draining) setImmediate(() => void this.drain());
    } catch {
      this.dropped++;
      this.logger.error(JSON.stringify({ event: 'push_enqueue_failed' }));
    }
  }

  /** Envía las alertas en orden, una a la vez, hasta vaciar la cola. */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (!this.stopped && this.queue.length) {
        const message = this.queue.shift()!;
        await this.deliver(message);
      }
    } finally {
      this.draining = false;
    }
  }

  /** Envía un mensaje y registra el resultado. Nunca lanza: los errores solo se cuentan y se registran. */
  private async deliver(message: PushMessage): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      // Gana lo que ocurra primero: la respuesta de FCM o el timeout configurado.
      const messageId = await Promise.race([
        this.sender.sendToTopic(this.config.topic, message),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(TIMEOUT), this.config.sendTimeoutMs);
        }),
      ]);
      this.sent++;
      this.logger.log(
        JSON.stringify({
          event: 'push_sent',
          sender: this.sender.kind,
          correlationId: message.data.correlationId,
          messageId,
        }),
      );
    } catch (error) {
      this.failed++;
      const code = errorCode(error);
      this.lastError = { code, atMs: Date.now() };
      this.logger.error(
        JSON.stringify({
          event: 'push_failed',
          sender: this.sender.kind,
          correlationId: message.data.correlationId,
          code,
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Suscribe un dispositivo al tópico del ambiente; lo usa POST /notifications/devices. */
  async registerDevice(token: string): Promise<{ topic: string }> {
    await this.sender.subscribe(token, this.config.topic);
    return { topic: this.config.topic };
  }

  /** Retira un dispositivo del tópico; lo usa DELETE /notifications/devices. */
  async unregisterDevice(token: string): Promise<void> {
    await this.sender.unsubscribe(token, this.config.topic);
  }

  /** Espera a que la cola actual termine; usado por pruebas y apagado ordenado. */
  async whenIdle(): Promise<void> {
    while (this.draining || this.queue.length) await new Promise((resolve) => setImmediate(resolve));
  }

  /** Contadores para GET /notifications/status. */
  getStatus(): PushDeliveryStatus {
    return {
      sender: this.sender.kind,
      topic: this.config.topic,
      queued: this.queue.length,
      sent: this.sent,
      failed: this.failed,
      dropped: this.dropped,
      lastError: this.lastError,
    };
  }

  /** Al apagar el backend, lo que quedaba en cola se cuenta como descartado. */
  onModuleDestroy(): void {
    this.stopped = true;
    this.dropped += this.queue.length;
    this.queue = [];
  }
}
