import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { serverTls } from './config/server-tls';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  await ConfigModule.envVariablesLoaded;
  const httpsOptions = serverTls((key) => process.env[key]);
  const app = await NestFactory.create(AppModule, { httpsOptions });
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);

  // Global validation pipe with strict transformation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Enable CORS for mobile app and web dashboards
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  await app.listen(port);
  logger.log(`RiTech Backend Modular Monolith running on ${httpsOptions ? 'https' : 'http'}://localhost:${port}`);
  logger.log(`Telemetry WebSockets listening via Socket.io namespace /telemetry`);
}

bootstrap();
