import { Inject, Injectable, NestMiddleware, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, Observable } from 'rxjs';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    tenantId: string;
    roles: string[];
  };
  tenantId?: string;
}

interface ValidateTokenResponse {
  valid: boolean;
  user?: {
    id: string;
    email: string;
    tenant_ids: string[];
    roles: string[];
  };
  error?: string;
}

interface AuthServiceGrpc {
  validateToken(data: { token: string; tenant_id?: string }): Observable<ValidateTokenResponse>;
}

@Injectable()
export class AuthMiddleware implements NestMiddleware, OnModuleInit {
  private authService: AuthServiceGrpc;
  private readonly publicPaths = [
    '/api/v1/health',
    '/api/v1/auth/login',
    '/api/v1/auth/register',
    '/api/v1/auth/refresh',
    '/api/v1/public',
  ];

  constructor(
    private readonly configService: ConfigService,
    @Inject('AUTH_SERVICE') private readonly client: ClientGrpc,
  ) {}

  onModuleInit() {
    this.authService = this.client.getService<AuthServiceGrpc>('AuthService');
  }

  async use(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    // Skip auth for public paths
    if (this.isPublicPath(req.path)) {
      return next();
    }

    // Extract tenant from subdomain or header
    req.tenantId = this.extractTenantId(req);

    // Get authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7);

    try {
      // Verify token with auth service (gRPC call)
      const user = await this.verifyToken(token, req.tenantId);
      req.user = user;
      
      // Add user info to headers for downstream services
      req.headers['x-user-id'] = user.id;
      req.headers['x-tenant-id'] = user.tenantId;
      req.headers['x-user-roles'] = user.roles.join(',');
      
      next();
    } catch (err) {
      throw new UnauthorizedException(err instanceof Error ? err.message : 'Invalid or expired token');
    }
  }

  private isPublicPath(path: string): boolean {
    return this.publicPaths.some(p => path.startsWith(p));
  }

  private extractTenantId(req: Request): string {
    // From header (API clients)
    const headerTenant = req.headers['x-tenant-id'] as string;
    if (headerTenant) return headerTenant;

    // From subdomain (web clients): league.ssl.mtkcodex.site
    const host = req.headers.host || '';
    const subdomain = host.split('.')[0];
    if (subdomain && subdomain !== 'api' && subdomain !== 'www') {
      return subdomain;
    }

    return 'default';
  }

  private async verifyToken(token: string, tenantId?: string): Promise<{
    id: string;
    email: string;
    tenantId: string;
    roles: string[];
  }> {
    try {
      const response = await firstValueFrom(
        this.authService.validateToken({ token, tenant_id: tenantId }),
      );
      
      if (response && response.valid && response.user) {
        return {
          id: response.user.id,
          email: response.user.email,
          tenantId: response.user.tenant_ids?.[0] || tenantId || 'default',
          roles: response.user.roles || ['user'],
        };
      }
      
      throw new Error(response?.error || 'Invalid credentials');
    } catch (error) {
      // In development mode, fallback to decoding the JWT locally if auth service is down/unavailable
      if (this.configService.get('NODE_ENV') === 'development') {
        console.warn('gRPC Auth Service unavailable, falling back to local JWT decode');
        const payload = this.decodeJwt(token);
        
        return {
          id: String(payload.sub || ''),
          email: String(payload.email || ''),
          tenantId: tenantId || String(payload.tenantId || 'default'),
          roles: Array.isArray(payload.roles) ? payload.roles as string[] : ['user'],
        };
      }
      
      throw new UnauthorizedException(error instanceof Error ? error.message : 'Authentication service unavailable');
    }
  }

  private decodeJwt(token: string): Record<string, unknown> {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Invalid token');
      
      const payload = Buffer.from(parts[1], 'base64').toString('utf8');
      return JSON.parse(payload);
    } catch {
      throw new UnauthorizedException('Invalid token format');
    }
  }
}

