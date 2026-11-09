import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Post,
  ServiceUnavailableException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import { PushNotificationService } from './push-notification.service';

/**
 * Endpoints que usa la app móvil para registrarse en las alertas push,
 * más un endpoint de estado para operación (/notifications/status).
 */

/** Cuerpo de POST /notifications/devices. */
export class DeviceRegistrationDto {
  /** Token de registro FCM del dispositivo; nunca se registra en logs. */
  @IsString()
  @MaxLength(4096)
  @Matches(/^[A-Za-z0-9_:.-]{20,4096}$/)
  token: string;

  @IsIn(['android', 'ios', 'web'])
  platform: 'android' | 'ios' | 'web';
}

/** Cuerpo de DELETE /notifications/devices (el token va en el cuerpo, no en la URL, para que no quede en logs de acceso). */
export class DeviceUnregistrationDto {
  @IsString()
  @MaxLength(4096)
  @Matches(/^[A-Za-z0-9_:.-]{20,4096}$/)
  token: string;
}

/** Códigos de FCM que indican un token malo: se responden como 400 y no como 503. */
const INVALID_TOKEN_CODES = [
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
];

@Controller('notifications')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(private readonly push: PushNotificationService) {}

  /** Emisor activo, tópico y contadores de envíos (enviados, fallidos, descartados). */
  @Get('status')
  status() {
    return this.push.getStatus();
  }

  /** Suscribe el dispositivo al tópico de alertas del ambiente. */
  @Post('devices')
  @HttpCode(201)
  async register(@Body() body: DeviceRegistrationDto) {
    try {
      const { topic } = await this.push.registerDevice(body.token);
      return { registered: true, topic, platform: body.platform };
    } catch (error) {
      throw this.map(error, 'push_register_failed');
    }
  }

  /** Retira el dispositivo del tópico (por ejemplo, al cerrar sesión). */
  @Delete('devices')
  @HttpCode(204)
  async unregister(@Body() body: DeviceUnregistrationDto) {
    try {
      await this.push.unregisterDevice(body.token);
    } catch (error) {
      throw this.map(error, 'push_unregister_failed');
    }
  }

  /**
   * Traduce el error a una respuesta HTTP: 503 si push está deshabilitado o FCM no responde,
   * 400 si el token es inválido. Solo se registra el código, nunca el token.
   */
  private map(error: unknown, event: string) {
    const code =
      (error as { code?: string })?.code ?? (error as Error)?.message ?? 'unknown';
    this.logger.warn(JSON.stringify({ event, code }));
    if (code === 'push_disabled')
      return new ServiceUnavailableException('Notificaciones push deshabilitadas en este ambiente');
    if (INVALID_TOKEN_CODES.includes(code))
      return new BadRequestException('Token de dispositivo inválido');
    return new ServiceUnavailableException('No fue posible contactar FCM');
  }
}
