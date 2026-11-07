import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StopLossTrigger } from '../hedging/dynamic-stop-loss';
import { StopLossService } from '../hedging/stop-loss.service';
import { TelemetryGateway } from '../telemetry/telemetry.gateway';
import { buildHedgingPushMessage, HEDGING_PUSH_SCHEMA_VERSION } from './hedging-push.payload';
import { NOTIFICATIONS_CONFIG, parseNotificationsConfig } from './notifications.config';
import { NotificationsController } from './notifications.controller';
import { PushNotificationService } from './push-notification.service';
import { DisabledPushSender, PUSH_SENDER, PushSender } from './push-sender';

const trigger = (overrides: Partial<StopLossTrigger> = {}): StopLossTrigger => ({
  schemaVersion: 1,
  correlationId: 'QQQ:1791345600000',
  symbol: 'QQQ',
  price: 512.345,
  eventTimeMs: 1791345600000,
  detectedAtMs: 1791345600010,
  triggeredAtMs: 1791345600020,
  fallPercentPerMinute: 0.75,
  policy: 'FAST',
  action: 'STOP_LOSS_REQUEST',
  ...overrides,
});

function fakeSender(impl: Partial<PushSender> = {}): jest.Mocked<PushSender> {
  return {
    kind: 'fcm',
    sendToTopic: jest.fn().mockResolvedValue('projects/p/messages/1'),
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    ...impl,
  } as jest.Mocked<PushSender>;
}

const config = (env: Record<string, string> = {}) =>
  parseNotificationsConfig({ FCM_SEND_TIMEOUT_MS: '100', ...env });

describe('payload versionado de hedging', () => {
  it('serializa todo como string y apunta al detalle de la orden', () => {
    const message = buildHedgingPushMessage(trigger({ correlationId: 'QQQ:1/2' }));
    expect(message.data).toMatchObject({
      schemaVersion: HEDGING_PUSH_SCHEMA_VERSION,
      type: 'HEDGING_ACTIVATED',
      correlationId: 'QQQ:1/2',
      route: '/orders/QQQ%3A1%2F2',
      price: '512.345',
      triggeredAtMs: '1791345600020',
    });
    expect(Object.values(message.data).every((value) => typeof value === 'string')).toBe(true);
    expect(message.title).toBe('Hedging activado en QQQ');
    expect(message.body).toContain('caída rápida');
    expect(message.body).toContain('512.35 USD');
  });
});

describe('parseNotificationsConfig', () => {
  it('queda deshabilitado por defecto con tópico por ambiente', () => {
    expect(parseNotificationsConfig({})).toMatchObject({
      enabled: false,
      environment: 'development',
      topic: 'hedging-alerts-development',
      sendTimeoutMs: 5000,
      queueCapacity: 256,
    });
    expect(parseNotificationsConfig({ NODE_ENV: 'test' }).topic).toBe('hedging-alerts-test');
  });

  it('exige proyecto al habilitar y valida sin filtrar valores', () => {
    expect(() => parseNotificationsConfig({ FCM_ENABLED: 'true' })).toThrow('FCM_PROJECT_ID');
    expect(() => parseNotificationsConfig({ FCM_ENABLED: 'si' })).toThrow('FCM_ENABLED');
    expect(() => parseNotificationsConfig({ FCM_PROJECT_ID: 'Secret Project!' })).toThrow(
      /^Configuración de notificaciones inválida: FCM_PROJECT_ID [^S]*$/,
    );
    expect(() => parseNotificationsConfig({ FCM_CREDENTIALS_PATH: '/tmp/key.pem' })).toThrow(
      'FCM_CREDENTIALS_PATH',
    );
    expect(() => parseNotificationsConfig({ FCM_TOPIC: 'no válido' })).toThrow('FCM_TOPIC');
  });

  it('impide que producción comparta tópico con desarrollo', () => {
    expect(() =>
      parseNotificationsConfig({ NODE_ENV: 'production', FCM_TOPIC: 'hedging-alerts-development' }),
    ).toThrow('-production');
    expect(parseNotificationsConfig({ NODE_ENV: 'production' }).topic).toBe(
      'hedging-alerts-production',
    );
    expect(
      parseNotificationsConfig({ FCM_ENABLED: 'true', FCM_PROJECT_ID: 'ritech-dev-1234' }),
    ).toMatchObject({ enabled: true, projectId: 'ritech-dev-1234' });
  });
});

describe('PushNotificationService', () => {
  it('envía al tópico del ambiente sin bloquear al llamador', async () => {
    const sender = fakeSender();
    const service = new PushNotificationService(config(), sender);
    service.notifyHedgingActivated(trigger());
    // Encolado síncrono: todavía no se contactó a FCM.
    expect(sender.sendToTopic).not.toHaveBeenCalled();
    await service.whenIdle();
    expect(sender.sendToTopic).toHaveBeenCalledWith(
      'hedging-alerts-development',
      expect.objectContaining({ data: expect.objectContaining({ type: 'HEDGING_ACTIVATED' }) }),
    );
    expect(service.getStatus()).toMatchObject({ sent: 1, failed: 0, queued: 0 });
  });

  it('registra errores de entrega y continúa con las siguientes alertas', async () => {
    const sender = fakeSender({
      sendToTopic: jest
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'messaging/internal-error' }))
        .mockResolvedValueOnce('ok'),
    });
    const service = new PushNotificationService(config(), sender);
    service.notifyHedgingActivated(trigger({ correlationId: 'QQQ:1' }));
    service.notifyHedgingActivated(trigger({ correlationId: 'QQQ:2' }));
    await service.whenIdle();
    expect(service.getStatus()).toMatchObject({
      sent: 1,
      failed: 1,
      lastError: { code: 'messaging/internal-error' },
    });
  });

  it('corta envíos colgados por timeout', async () => {
    const sender = fakeSender({ sendToTopic: jest.fn(() => new Promise<string>(() => undefined)) });
    const service = new PushNotificationService(config(), sender);
    service.notifyHedgingActivated(trigger());
    await service.whenIdle();
    expect(service.getStatus()).toMatchObject({ failed: 1, lastError: { code: 'fcm_timeout' } });
  });

  it('acota la cola descartando la alerta más antigua', async () => {
    const sender = fakeSender();
    const service = new PushNotificationService(config({ FCM_QUEUE_CAPACITY: '2' }), sender);
    for (let i = 0; i < 4; i++) service.notifyHedgingActivated(trigger({ correlationId: `QQQ:${i}` }));
    expect(service.getStatus()).toMatchObject({ queued: 2, dropped: 2 });
    await service.whenIdle();
    expect(sender.sendToTopic.mock.calls.map(([, m]) => m.data.correlationId)).toEqual([
      'QQQ:2',
      'QQQ:3',
    ]);
  });

  it('una falla de FCM no afecta la publicación del stop-loss', async () => {
    const sender = fakeSender({ sendToTopic: jest.fn().mockRejectedValue(new Error('down')) });
    const push = new PushNotificationService(config(), sender);
    const broadcastHedgingAlert = jest.fn();
    const stop = new StopLossService(
      { broadcastHedgingAlert } as unknown as TelemetryGateway,
      undefined,
      push,
    );
    const now = Date.now();
    stop.enqueue({ symbol: 'QQQ', price: 100, eventTimeMs: now - 1000 });
    stop.enqueue({ symbol: 'QQQ', price: 99, eventTimeMs: now });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(broadcastHedgingAlert).toHaveBeenCalledTimes(1);
    await push.whenIdle();
    expect(push.getStatus()).toMatchObject({ failed: 1, sent: 0 });
    stop.onModuleDestroy();
  });
});

describe('NotificationsController', () => {
  let app: INestApplication;
  let sender: jest.Mocked<PushSender>;
  const token = 'fcm-token_ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789';

  async function start(pushSender: PushSender) {
    const module = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        PushNotificationService,
        { provide: NOTIFICATIONS_CONFIG, useValue: config() },
        { provide: PUSH_SENDER, useValue: pushSender },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    return app.getUrl();
  }

  const call = (url: string, method: string, body?: unknown) =>
    fetch(`${url}/notifications/devices`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  afterEach(async () => app?.close());

  it('registra y elimina un dispositivo en el tópico', async () => {
    sender = fakeSender();
    const url = await start(sender);
    const created = await call(url, 'POST', { token, platform: 'android' });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      registered: true,
      topic: 'hedging-alerts-development',
      platform: 'android',
    });
    expect(sender.subscribe).toHaveBeenCalledWith(token, 'hedging-alerts-development');
    expect((await call(url, 'DELETE', { token })).status).toBe(204);
    expect(sender.unsubscribe).toHaveBeenCalledWith(token, 'hedging-alerts-development');
  });

  it('valida el payload y traduce errores de FCM', async () => {
    sender = fakeSender({
      subscribe: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('bad'), { code: 'messaging/invalid-registration-token' })),
    });
    const url = await start(sender);
    expect((await call(url, 'POST', { token: 'corto', platform: 'android' })).status).toBe(400);
    expect((await call(url, 'POST', { token, platform: 'symbian' })).status).toBe(400);
    expect((await call(url, 'POST', { token, platform: 'ios', extra: 1 })).status).toBe(400);
    expect((await call(url, 'POST', { token, platform: 'ios' })).status).toBe(400);
  });

  it('responde 503 cuando el ambiente no tiene FCM', async () => {
    const url = await start(new DisabledPushSender());
    expect((await call(url, 'POST', { token, platform: 'web' })).status).toBe(503);
    const status = await (await fetch(`${url}/notifications/status`)).json();
    expect(status).toMatchObject({ sender: 'disabled', topic: 'hedging-alerts-development' });
  });
});
