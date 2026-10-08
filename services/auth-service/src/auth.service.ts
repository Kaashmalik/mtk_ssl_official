import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RbacService } from './rbac/rbac.service';
import { createClerkClient, verifyToken } from '@clerk/backend';


export interface ValidateTokenRequest {
  token: string;
  tenantId?: string;
}

export interface User {
  id: string;
  email: string;
  tenant_ids: string[];
  roles: string[];
}

export interface ValidateTokenResponse {
  valid: boolean;
  user?: User;
  error?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly rbacService: RbacService,
  ) {}

  async validateToken(request: ValidateTokenRequest): Promise<ValidateTokenResponse> {
    try {
      const clerkSecretKey = this.configService.get<string>('CLERK_SECRET_KEY');
      
      // Real validation with Clerk Backend SDK
      if (clerkSecretKey && request.token && request.token !== 'invalid') {
        const clerk = createClerkClient({ secretKey: clerkSecretKey });
        try {
          const verifiedToken = await verifyToken(request.token, { secretKey: clerkSecretKey });
          const userId = verifiedToken.sub;
          
          let email = '';
          try {
            const clerkUser = await clerk.users.getUser(userId);
            email = clerkUser.emailAddresses[0]?.emailAddress || '';
          } catch (userErr) {
            // Log warning but proceed with token subject if user fetch fails (e.g. rate limit/network)
            console.warn(`Failed to fetch user details from Clerk: ${userErr}`);
          }

          const tenantId = request.tenantId || 'tenant_default';
          const roles = await this.rbacService.getUserRoles(userId, tenantId);

          return {
            valid: true,
            user: {
              id: userId,
              email: email || 'authenticated-user@clerk.internal',
              tenant_ids: [tenantId],
              roles: roles.length > 0 ? roles : ['user'],
            },
          };
        } catch (verifyErr) {
          return {
            valid: false,
            error: verifyErr instanceof Error ? verifyErr.message : 'Clerk token verification failed',
          };
        }
      }

      // Fallback for development if Clerk is not fully configured
      if (!request.token || request.token === 'invalid') {
        return { valid: false, error: 'Invalid or missing token' };
      }

      const tenantId = request.tenantId || 'tenant_default';
      const user: User = {
        id: 'user_123',
        email: 'test@ssl.mtkcodex.site',
        tenant_ids: [tenantId],
        roles: ['user'],
      };

      return { valid: true, user };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async checkPermission(
    userId: string,
    tenantId: string,
    resource: string,
    action: string,
  ): Promise<boolean> {
    return this.rbacService.checkPermission(userId, tenantId, resource, action);
  }

  async getUserRoles(userId: string, tenantId: string): Promise<string[]> {
    return this.rbacService.getUserRoles(userId, tenantId);
  }

  async assignRole(userId: string, tenantId: string, role: string): Promise<void> {
    await this.rbacService.assignRole(userId, tenantId, role);
  }

  async revokeRole(userId: string, tenantId: string, role: string): Promise<void> {
    await this.rbacService.revokeRole(userId, tenantId, role);
  }
}

