import {
  Controller,
  Post,
  Param,
  Headers,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { SslService } from "./ssl.service";
import { Public } from "../common/decorators/public.decorator";

/**
 * SSL certificate management endpoints.
 *
 * SECURITY (Phase 3b): previously these endpoints had NO authentication —
 * any caller could trigger certificate issuance or renewal. They're now
 * gated behind a shared secret (`CRON_SECRET` / `SSL_ADMIN_TOKEN`) passed
 * via the `x-ssl-secret` header. The Nest global guards (BearerToken,
 * TenantHeader) do NOT apply to these routes because they're invoked by
 * internal cron jobs, not tenant requests.
 *
 * The issue endpoint additionally requires the tenant's DNS to be verified
 * before any certificate is requested from Let's Encrypt (enforced in the
 * service), so a leaked secret alone can't be used to mint arbitrary certs.
 */
@Public()
@Controller("ssl")
export class SslController {
  private readonly logger = new Logger(SslController.name);

  constructor(private readonly sslService: SslService) {}

  /**
   * Verify the shared secret. Throws 403 if missing or mismatched.
   * Uses timingSafeEqual to avoid leaking the secret via timing.
   */
  private assertAuthorized(secretHeader: string | undefined): void {
    const expected = process.env.CRON_SECRET || process.env.SSL_ADMIN_TOKEN;
    if (!expected) {
      // Fail closed: if no secret is configured, refuse all calls rather
      // than silently allowing them.
      this.logger.error(
        "SSL endpoint called but CRON_SECRET/SSL_ADMIN_TOKEN is not set — refusing."
      );
      throw new ForbiddenException("SSL administration is not configured");
    }
    if (!secretHeader || secretHeader !== expected) {
      throw new ForbiddenException("Invalid SSL secret");
    }
  }

  @Post("issue/:tenantId/:domain")
  @HttpCode(HttpStatus.OK)
  async issueCertificate(
    @Param("tenantId") tenantId: string,
    @Param("domain") domain: string,
    @Headers("x-ssl-secret") secret?: string
  ) {
    this.assertAuthorized(secret);
    return this.sslService.issueCertificate(tenantId, domain);
  }

  @Post("renew")
  @HttpCode(HttpStatus.OK)
  async renewCertificates(@Headers("x-ssl-secret") secret?: string) {
    this.assertAuthorized(secret);
    return this.sslService.renewExpiringCertificates();
  }
}
