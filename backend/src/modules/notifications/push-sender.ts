import { Logger } from '@nestjs/common';
import type { App } from 'firebase-admin/app';
import type { NotificationsConfig } from './notifications.config';
import type { PushMessage } from './hedging-push.payload';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface PushSender {
  readonly kind: 'fcm' | 'disabled';
  /** Resuelve con el id del mensaje; rechaza si FCM no lo acepta. */
  sendToTopic(topic: string, message: PushMessage): Promise<string>;
  subscribe(token: string, topic: string): Promise<void>;
  unsubscribe(token: string, topic: string): Promise<void>;
}

/** Sin FCM configurado: registra la intención y no contacta servicios externos. */
export class DisabledPushSender implements PushSender {
  readonly kind = 'disabled' as const;
  private readonly logger = new Logger('DisabledPushSender');

  async sendToTopic(topic: string, message: PushMessage): Promise<string> {
    this.logger.debug(
      JSON.stringify({ event: 'push_skipped_disabled', topic, correlationId: message.data.correlationId }),
    );
    return 'disabled';
  }

  async subscribe(): Promise<void> {
    throw new Error('push_disabled');
  }

  async unsubscribe(): Promise<void> {
    throw new Error('push_disabled');
  }
}

export class FcmPushSender implements PushSender {
  readonly kind = 'fcm' as const;
  private app?: Promise<App>;

  constructor(private readonly config: NotificationsConfig) {}

  private getApp(): Promise<App> {
    // Carga diferida: el SDK solo se importa cuando FCM está habilitado.
    this.app ??= (async () => {
      const { initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
      return initializeApp(
        {
          projectId: this.config.projectId,
          credential: this.config.credentialsPath
            ? cert(this.config.credentialsPath)
            : applicationDefault(),
        },
        `ritech-push-${this.config.environment}`,
      );
    })();
    return this.app;
  }

  private async messaging() {
    const { getMessaging } = await import('firebase-admin/messaging');
    return getMessaging(await this.getApp());
  }

  async sendToTopic(topic: string, message: PushMessage): Promise<string> {
    const messaging = await this.messaging();
    return messaging.send({
      topic,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: {
        priority: 'high',
        // Una alerta nueva del mismo episodio reemplaza a la anterior en la bandeja.
        collapseKey: message.data.correlationId,
        notification: { channelId: 'hedging_alerts' },
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default', 'thread-id': 'hedging' } },
      },
    });
  }

  async subscribe(token: string, topic: string): Promise<void> {
    const response = await (await this.messaging()).subscribeToTopic([token], topic);
    if (response.failureCount) throw new Error(response.errors[0]?.error.code ?? 'fcm_subscribe_failed');
  }

  async unsubscribe(token: string, topic: string): Promise<void> {
    const response = await (await this.messaging()).unsubscribeFromTopic([token], topic);
    if (response.failureCount) throw new Error(response.errors[0]?.error.code ?? 'fcm_unsubscribe_failed');
  }
}
