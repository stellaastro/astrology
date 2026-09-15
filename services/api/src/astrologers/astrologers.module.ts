import { Module } from '@nestjs/common';
import { AstrologersService } from './astrologers.service';
import { AdminAstrologersController, PublicAstrologersController } from './astrologers.controller';

@Module({
  controllers: [PublicAstrologersController, AdminAstrologersController],
  providers: [AstrologersService],
  exports: [AstrologersService],
})
export class AstrologersModule {}
