import { Module } from '@nestjs/common';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { RetentionService } from './retention.service';

@Module({
  controllers: [PrivacyController],
  providers: [PrivacyService, RetentionService],
  exports: [PrivacyService, RetentionService],
})
export class PrivacyModule {}
