import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  NOTIFICATIONS_CONFIG,
  NotificationsConfig,
  parseNotificationsConfig,
} from './notifications.config';
import { NotificationsController } from './notifications.controller';
import { PushNotificationService } from './push-notification.service';
import { DisabledPushSender, FcmPushSender, PUSH_SENDER } from './push-sender';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: NOTIFICATIONS_CONFIG,
      inject: [ConfigService],
      // Sin la clave cargada (p. ej. módulos de prueba) se parsea el entorno: FCM queda deshabilitado.
      useFactory: (config: ConfigService): NotificationsConfig =>
        config.get<NotificationsConfig>('notifications') ??
        parseNotificationsConfig(process.env),
    },
    {
      provide: PUSH_SENDER,
      inject: [NOTIFICATIONS_CONFIG],
      useFactory: (config: NotificationsConfig) =>
        config.enabled ? new FcmPushSender(config) : new DisabledPushSender(),
    },
    PushNotificationService,
  ],
  controllers: [NotificationsController],
  exports: [PushNotificationService],
})
export class NotificationsModule {}
