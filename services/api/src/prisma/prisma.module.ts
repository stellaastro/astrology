import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// One provider, one connection pool. Services inject PrismaService directly;
// aliasing PrismaClient as a second token only invited the type-vs-value
// import mistake that broke boot.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
