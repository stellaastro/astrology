import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { initSentry } from './observability/sentry';

async function bootstrap(): Promise<void> {
  // Before the app is created, so a crash during bootstrap is still reported.
  // A failure to start is exactly the kind nobody sees until a visitor does.
  initSentry();

  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
    /*
     * Keeps a copy of the unparsed body on `req.rawBody`.
     *
     * The Razorpay webhook signature is an HMAC over the bytes Razorpay sent.
     * Re-serialising the parsed JSON changes whitespace and key order, so the
     * signature stops matching for reasons that have nothing to do with
     * authenticity — and the usual response to that is to stop checking, which
     * is how a forged `payment.authorized` gets to confirm a booking nobody
     * paid for.
     *
     * This is global rather than scoped to the webhook route, which costs one
     * extra buffer per request. At 12-15 concurrent (ADR-008) that is not worth
     * the second body-parser configuration it would take to avoid, and a
     * route-scoped parser that silently stops matching after a path change is a
     * worse failure than the memory.
     */
    rawBody: true,
  });

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

  // Session cookies are httpOnly, so the guard reads them here rather than
  // from a header the browser would have to be trusted to send.
  app.use(cookieParser());

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, '127.0.0.1');
  new Logger('Bootstrap').log(
    `API listening on 127.0.0.1:${port} under /${process.env.API_GLOBAL_PREFIX ?? 'api/v1'}`,
  );
}

void bootstrap();
