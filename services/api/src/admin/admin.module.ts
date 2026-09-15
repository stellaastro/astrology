import { Module } from '@nestjs/common';
import { AdminLeadsController } from './admin-leads.controller';
import { AdminLeadsService } from './admin-leads.service';

@Module({
  controllers: [AdminLeadsController],
  providers: [AdminLeadsService],
})
export class AdminModule {}
