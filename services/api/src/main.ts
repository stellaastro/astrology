import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { initSentry } from './observability/sentry';

async function bootstrap(): Promise<void> {
  // Before the app is created, so a crash during bootstrap is still reported.
  // A failure to start is exactly the kind nobody sees until a visitor does.
  initSentry();

  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // nginx proxies /api/v1 WITHOUT stripping the prefix, so the API owns it.
  // The path is then identical whether reached through nginx or directly on
  // :4000 — which matters the day a webhook fails on only one of those.
  app.setGlobalPrefix(process.env.API_GLOBAL_PREFIX ?? 'api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,            // strip unknown properties
      forbidNonWhitelisted: true, // and reject rather than ignore them
      transform: true,
    }),
  );

  // Behind nginx: trust the proxy so req.ip is the client, not 127.0.0.1.
  // Rate limiting and audit records are worthless if every request looks local.
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, '127.0.0.1');
  new Logger('Bootstrap').log(
    `API listening on 127.0.0.1:${port} under /${process.env.API_GLOBAL_PREFIX ?? 'api/v1'}`,
  );
}

void bootstrap();
