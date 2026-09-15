import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { CoreModule } from './core/core.module';
import { FixtureGuard } from './prisma/fixture-guard';
import { HealthController } from './health/health.controller';
import { SchedulerService } from './scheduler/scheduler.service';
import { LeadsModule } from './leads/leads.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The repo root .env, two levels up from services/api.
      envFilePath: ['../../.env'],
    }),
    // In-process cron. Single instance only — see SchedulerService.
    ScheduleModule.forRoot(),

    // Rate limiting. In-memory for now, which is correct while there is one
    // API process: a Redis store would add a dependency without adding a
    // guarantee. It becomes wrong the moment a second replica exists, because
    // each would then enforce its own separate limit.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 30 }]),

    PrismaModule,
    CoreModule,
    LeadsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Applies the limit to every route; individual routes tighten it with
    // @Throttle. Without this the decorator is decorative.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    FixtureGuard,
    SchedulerService,
  ],
})
export class AppModule {}
