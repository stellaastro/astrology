import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { TurnstileService } from '../turnstile/turnstile.service';

@Module({
  controllers: [LeadsController],
  providers: [LeadsService, TurnstileService],
  exports: [LeadsService],
})
export class LeadsModule {}
