import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { OutboxService } from '../outbox/outbox.service';

/**
 * Cross-cutting substrate.
 *
 * Audit, idempotency and the outbox are infrastructure that essentially every
 * feature module needs — leads today, bookings and payments later. Declaring
 * them in AppModule's providers does NOT make them visible to child modules,
 * which is what broke LeadsModule at boot: providers are module-scoped unless
 * exported through a module that the consumer imports.
 *
 * @Global so feature modules do not each have to import this and remember to
 * keep the list current. That is the right call for substrate and the wrong
 * one for domain services — a global module is invisible coupling, which is
 * acceptable exactly when the thing genuinely is ambient.
 */
@Global()
@Module({
  providers: [AuditService, IdempotencyService, OutboxService],
  exports: [AuditService, IdempotencyService, OutboxService],
})
export class CoreModule {}
