import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness only: is the process up. Deliberately touches nothing external,
   * so a database blip does not make a load balancer kill a healthy process.
   */
  @Get()
  live(): { status: string; uptime: number } {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  /**
   * Readiness: can this process actually serve requests. Checks the database,
   * because an API that cannot reach MySQL should not receive traffic.
   */
  @Get('ready')
  async ready(): Promise<{ status: string; checks: Record<string, string> }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      // No error detail in the response body: a health endpoint is public and
      // connection strings and hostnames do not belong in it.
      throw new ServiceUnavailableException({
        status: 'unavailable',
        checks: { database: 'unreachable' },
      });
    }
    return { status: 'ok', checks: { database: 'ok' } };
  }
}
