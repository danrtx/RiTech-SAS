/**
 * Puerto de envío push y sus dos implementaciones. El resto del backend depende solo
 * de la interfaz `PushSender`, así que cambiar de proveedor implica reemplazar este archivo.
 */
import { Logger } from '@nestjs/common';
import type { App } from 'firebase-admin/app';
import type { NotificationsConfig } from './notifications.config';
import type { PushMessage } from './hedging-push.payload';

/** Token de inyección de NestJS; el módulo elige FCM o deshabilitado según la configuración. */
export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface PushSender {
  /** Aparece en /notifications/status para saber qué emisor está activo. */
  readonly kind: 'fcm' | 'disabled';
  /** Resuelve con el id del mensaje; rechaza si FCM no lo acepta. */
  sendToTopic(topic: string, message: PushMessage): Promise<string>;
  /** Suscribe el token de un dispositivo al tópico de alertas. */
  subscribe(token: string, topic: string): Promise<void>;
  /** Retira el token de un dispositivo del tópico de alertas. */
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

  // El controlador traduce 'push_disabled' en un HTTP 503 para la app.
  async subscribe(): Promise<void> {
    throw new Error('push_disabled');
  }

  async unsubscribe(): Promise<void> {
    throw new Error('push_disabled');
  }
}

/** Envío real a Firebase Cloud Messaging mediante el Admin SDK. */
export class FcmPushSender implements PushSender {
  readonly kind = 'fcm' as const;
  /** App de Firebase creada una sola vez, en el primer uso. */
  private app?: Promise<App>;

  constructor(private readonly config: NotificationsConfig) {}

  private getApp(): Promise<App> {
    // Carga diferida: el SDK solo se importa cuando FCM está habilitado.
    this.app ??= (async () => {
      const { initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
      // App con nombre propio para no chocar con otra app de Firebase del mismo proceso.
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
      // `notification` lo muestra el sistema con la app en background o cerrada;
      // `data` es lo que la app lee para abrir el detalle de la orden.
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: {
        // Alta prioridad: entrega inmediata aunque el teléfono esté en modo de ahorro.
        priority: 'high',
        // Una alerta nueva del mismo episodio reemplaza a la anterior en la bandeja.
        collapseKey: message.data.correlationId,
        // Mismo canal que crea la app (FlutterLocalAlertNotifier) y declara el AndroidManifest.
        notification: { channelId: 'hedging_alerts' },
      },
      // iOS: prioridad 10 = entrega inmediata; thread-id agrupa las alertas de hedging.
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default', 'thread-id': 'hedging' } },
      },
    });
  }

  // El Admin SDK no lanza si el token es inválido: informa failureCount y aquí se convierte en error.
  async subscribe(token: string, topic: string): Promise<void> {
    const response = await (await this.messaging()).subscribeToTopic([token], topic);
    if (response.failureCount) throw new Error(response.errors[0]?.error.code ?? 'fcm_subscribe_failed');
  }

  async unsubscribe(token: string, topic: string): Promise<void> {
    const response = await (await this.messaging()).unsubscribeFromTopic([token], topic);
    if (response.failureCount) throw new Error(response.errors[0]?.error.code ?? 'fcm_unsubscribe_failed');
  }
}
