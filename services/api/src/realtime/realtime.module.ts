import { Global, Module } from '@nestjs/common';
import { HmsService } from './hms.service';
import { REALTIME_PROVIDER } from './realtime.provider';

/**
 * The realtime provider, bound behind its interface token so booking and
 * consultation code never names 100ms.
 */
@Global()
@Module({
  providers: [HmsService, { provide: REALTIME_PROVIDER, useExisting: HmsService }],
  exports: [HmsService, REALTIME_PROVIDER],
})
export class RealtimeModule {}
