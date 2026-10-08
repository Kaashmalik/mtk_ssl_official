import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { TenantScopeGuard, TENANT_HEADER } from './tenant-scope.guard';

const VALID_UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

function ctxFor(headers: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('TenantScopeGuard', () => {
  let guard: TenantScopeGuard;

  beforeEach(() => {
    guard = new TenantScopeGuard();
  });

  it('attaches a trimmed tenantId for a valid uuid', () => {
    const req: { headers: Record<string, unknown>; tenantId?: string } = {
      headers: { [TENANT_HEADER]: `  ${VALID_UUID}  ` },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.tenantId).toBe(VALID_UUID);
  });

  it('accepts an array header and uses the first value', () => {
    const req: { headers: Record<string, unknown>; tenantId?: string } = {
      headers: { [TENANT_HEADER]: [VALID_UUID, 'second'] },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.tenantId).toBe(VALID_UUID);
  });

  // The whole point of this guard: a missing tenant must fail closed rather
  // than degrade into an unscoped write.
  it.each([
    ['missing header', {}],
    ['undefined value', { [TENANT_HEADER]: undefined }],
    ['empty string', { [TENANT_HEADER]: '' }],
    ['empty array', { [TENANT_HEADER]: [] }],
    ['non-uuid string', { [TENANT_HEADER]: 'not-a-uuid' }],
    ['sql injection attempt', { [TENANT_HEADER]: "' OR 1=1 --" }],
    ['numeric', { [TENANT_HEADER]: 12345 }],
    ['object', { [TENANT_HEADER]: { id: VALID_UUID } }],
    ['uuid missing hyphens', { [TENANT_HEADER]: VALID_UUID.replace(/-/g, '') }],
    ['uuid with trailing junk', { [TENANT_HEADER]: `${VALID_UUID}x` }],
  ])('rejects %s', (_label, headers) => {
    expect(() => guard.canActivate(ctxFor(headers))).toThrow(UnauthorizedException);
  });

  it('never attaches a tenantId when rejecting', () => {
    const req: { headers: Record<string, unknown>; tenantId?: string } = {
      headers: { [TENANT_HEADER]: 'not-a-uuid' },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(ctx)).toThrow();
    expect(req.tenantId).toBeUndefined();
  });
});