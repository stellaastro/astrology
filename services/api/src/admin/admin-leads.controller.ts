import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminLeadsService, MAX_PAGE } from './admin-leads.service';
import { Roles, type AuthedRequest } from '../auth/auth.guard';
import { SESSION_COOKIE } from '../auth/session.service';
import { createHash } from 'node:crypto';

/**
 * The waitlist, for administrators.
 *
 * Not @Public(): the app-wide guard denies by default, and @Roles narrows it
 * further to admins. Both matter — authentication says who you are, the role
 * says whether you may read every customer's email address.
 */
@Controller('admin/leads')
@Roles('admin')
export class AdminLeadsController {
  constructor(private readonly leads: AdminLeadsService) {}

  private actor(req: AuthedRequest) {
    const cookies = (req as { cookies?: Record<string, string> }).cookies ?? {};
    const raw = cookies[SESSION_COOKIE];
    return {
      id: req.user?.id ?? 'unknown',
      role: req.user?.roles?.[0] ?? 'unknown',
      ip: req.ip,
      // The session's identity WITHOUT the credential, so two actions can be
      // tied to one sitting without the audit log storing a usable cookie.
      sessionId: raw ? createHash('sha256').update(raw).digest('hex').slice(0, 16) : undefined,
    };
  }

  @Get()
  async list(
    @Req() req: AuthedRequest,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('confirmed') confirmed?: string,
  ) {
    return this.leads.list(this.actor(req), {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 25,
      confirmed:
        confirmed === 'true' ? true : confirmed === 'false' ? false : undefined,
    });
  }

  /**
   * CSV of every lead.
   *
   * Throttled far harder than browsing. This is the endpoint that takes the
   * whole mailing list out of the building, and a compromised admin session
   * should not be able to pull it repeatedly without the rate limit noticing.
   */
  @Get('export.csv')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="stella-leads.csv"')
  @Header('Cache-Control', 'no-store')
  async export(@Req() req: AuthedRequest) {
    return this.leads.exportCsv(this.actor(req));
  }
}

export { MAX_PAGE };
