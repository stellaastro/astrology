import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { FixtureGuard } from './prisma/fixture-guard';
import { HealthController } from './health/health.controller';
import { AuditService } from './audit/audit.service';
import { IdempotencyService } from './idempotency/idempotency.service';
import { OutboxService } from './outbox/outbox.service';
import { SchedulerService } from './scheduler/scheduler.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The repo root .env, two levels up from services/api.
      envFilePath: ['../../.env'],
    }),
    // In-process cron. Single instance only — see SchedulerService.
    ScheduleModule.forRoot(),
    PrismaModule,
  ],
  controllers: [HealthController],
  providers: [
    FixtureGuard,
    AuditService,
    IdempotencyService,
    OutboxService,
    SchedulerService,
  ],
  exports: [AuditService, IdempotencyService, OutboxService],
})
export class AppModule {}
