import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { AuditService } from './audit/audit.service';
import { IdempotencyService } from './idempotency/idempotency.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The repo root .env, two levels up from services/api.
      envFilePath: ['../../.env'],
    }),
    PrismaModule,
  ],
  controllers: [HealthController],
  providers: [AuditService, IdempotencyService],
  exports: [AuditService, IdempotencyService],
})
export class AppModule {}
