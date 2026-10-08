import { Injectable, OnModuleInit } from '@nestjs/common';
import { newEnforcer, Enforcer } from 'casbin';

@Injectable()
export class RbacService implements OnModuleInit {
  private enforcer: Enforcer;

  async onModuleInit() {
    // Initialize Casbin with RBAC model
    this.enforcer = await newEnforcer(
      'src/rbac/rbac_model.conf',
      'src/rbac/rbac_policy.csv',
    );
  }

  async checkPermission(
    userId: string,
    tenantId: string,
    resource: string,
    action: string,
  ): Promise<boolean> {
    return this.enforcer.enforce(userId, tenantId, resource, action);
  }

  async getUserRoles(userId: string, tenantId: string): Promise<string[]> {
    return this.enforcer.getRolesForUser(userId, tenantId);
  }

  async assignRole(userId: string, tenantId: string, role: string): Promise<void> {
    await this.enforcer.addRoleForUser(userId, role, tenantId);
  }

  async revokeRole(userId: string, tenantId: string, role: string): Promise<void> {
    await this.enforcer.deleteRoleForUser(userId, role, tenantId);
  }

  async addPolicy(role: string, tenantId: string, resource: string, action: string): Promise<void> {
    await this.enforcer.addPolicy(role, tenantId, resource, action);
  }
}
