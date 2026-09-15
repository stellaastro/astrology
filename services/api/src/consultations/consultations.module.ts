import { Module } from '@nestjs/common';
import { RecordingService } from './recording.service';

/**
 * Consultation recording, consent and assessment (ADR-048).
 *
 * No controllers yet, deliberately. Two owner decisions gate any endpoint that
 * could start a recording: the consent wording, and who reviews a flagged call
 * given the astrologer assessed cannot review themselves. The mechanism is
 * built and tested; exposing it before those answers exist would invite it
 * being used without them.
 */
@Module({
  providers: [RecordingService],
  exports: [RecordingService],
})
export class ConsultationsModule {}
