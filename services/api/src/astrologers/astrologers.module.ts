import { Module } from '@nestjs/common';
import { AstrologersService } from './astrologers.service';
import {
  AdminAstrologersController,
  AstrologerSelfController,
  PublicAstrologersController,
} from './astrologers.controller';

@Module({
  controllers: [PublicAstrologersController, AdminAstrologersController, AstrologerSelfController],
  providers: [AstrologersService],
  exports: [AstrologersService],
})
export class AstrologersModule {}
