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
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { AuthGuard } from './auth/auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      /*
       * The repo root .env is the DEVELOPMENT default. Production points
       * ENV_FILE at a file outside the docroot (see the stella-api systemd
       * drop-in), because .env carries APP_ENV=development and a DATABASE_URL
       * for stellaastro_dev.
       *
       * This is not cosmetic. Setting DATABASE_URL in the unit alone did NOT
       * work: ConfigModule loads the env file over the top of the process
       * environment, so the live public API kept writing to the dev database —
       * which holds synthetic fixture rows — while systemd insisted it was
       * production. Selecting the whole FILE is unambiguous in a way that
       * overriding individual variables was not.
       */
      envFilePath: [process.env.ENV_FILE ?? '../../.env'],
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
    // Registers the outbox handler that sends waitlist confirmations.
    MailModule,
    // Sessions, password sign-in, and the guard below.
    AuthModule,
    // Role-guarded admin surfaces.
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    /*
     * Applied to EVERY route. The guard denies unless a route carries
     * @Public(), so an endpoint added without thinking is closed rather than
     * open — the failure mode of forgetting is a locked door.
     */
    { provide: APP_GUARD, useClass: AuthGuard },
    // Applies the limit to every route; individual routes tighten it with
    // @Throttle. Without this the decorator is decorative.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    FixtureGuard,
    SchedulerService,
  ],
})
export class AppModule {}
