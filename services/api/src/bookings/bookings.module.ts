import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import {
  AdminBookingsController,
  AstrologerBookingsController,
  BookingsController,
} from './bookings.controller';
import { AvailabilityModule } from '../availability/availability.module';

/**
 * AvailabilityModule is imported rather than the service re-provided: a booking
 * must be validated against the SAME slot arithmetic that offered the slot in
 * the first place. A second copy of that logic is a second definition of when
 * an astrologer is free, and the two would drift.
 */
@Module({
  imports: [AvailabilityModule],
  controllers: [BookingsController, AstrologerBookingsController, AdminBookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
