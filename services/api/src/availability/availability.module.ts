import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import {
  AdminAvailabilityController,
  AstrologerAvailabilityController,
  PublicSlotsController,
} from './availability.controller';

@Module({
  controllers: [
    PublicSlotsController,
    AstrologerAvailabilityController,
    AdminAvailabilityController,
  ],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
