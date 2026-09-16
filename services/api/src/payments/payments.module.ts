import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { RazorpayService } from './razorpay.service';
import { PaymentsController, RazorpayWebhookController } from './payments.controller';
import { PAYMENTS_PROVIDER } from './payments.provider';
import { BookingsModule } from '../bookings/bookings.module';

/**
 * The provider is bound through a symbol rather than injected concretely, so
 * PaymentsService depends on the SEAM and not on Razorpay. There is deliberately
 * no mock payment provider: CLAUDE.md §71 forbids fake payment success, and a
 * stub that returns "paid" is precisely that. Unconfigured credentials produce
 * a refusal, never a pretend payment.
 */
@Module({
  imports: [BookingsModule],
  controllers: [PaymentsController, RazorpayWebhookController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENTS_PROVIDER,
      /*
       * useFactory, NOT useClass.
       *
       * RazorpayService takes the environment as a constructor argument so it
       * can be tested without mutating process.env. NestJS reads constructor
       * parameter types from emitDecoratorMetadata and tries to resolve that
       * `NodeJS.ProcessEnv` as a provider — a DEFAULT VALUE DOES NOT STOP IT —
       * and the app dies at boot with "can't resolve dependencies (?)".
       *
       * Caught by booting the real binary. Every unit test passed throughout,
       * because they construct the class directly and never go through the
       * container.
       */
      useFactory: (): RazorpayService => new RazorpayService(process.env),
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
