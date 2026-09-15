import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { SessionService } from './session.service';

/**
 * Global so AuthGuard can be applied app-wide without every module importing
 * it. The guard denies by default, so a new endpoint is closed unless it says
 * @Public() — the failure mode of forgetting is a locked door, not an open one.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, AuthGuard],
  exports: [AuthService, SessionService, AuthGuard],
})
export class AuthModule {}
