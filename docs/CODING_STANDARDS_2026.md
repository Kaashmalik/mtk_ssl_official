# MTK SSL - Coding Standards & Best Practices

**Version:** 1.0  
**Last Updated:** 2026-10-25  
**Status:** Mandatory for all new code

---

## 1. TypeScript Standards

### 1.1 Type Safety
```typescript
// ✅ DO: Explicit types
interface User {
  id: string;
  email: string;
  tenantId: string;
}

function getUser(id: string): Promise<User> {
  return db.users.findUnique({ where: { id } });
}

// ❌ DON'T: Any types
function getUser(id: any): any {
  return db.users.findUnique({ where: { id } });
}
```

### 1.2 Naming Conventions
- **Files:** `kebab-case.ts` (e.g., `user-service.ts`)
- **Classes:** `PascalCase` (e.g., `UserService`)
- **Functions:** `camelCase` (e.g., `getUserById`)
- **Constants:** `UPPER_SNAKE_CASE` (e.g., `MAX_RETRY_COUNT`)
- **Interfaces:** `PascalCase` with `I` prefix optional (e.g., `User` or `IUser`)
- **Types:** `PascalCase` (e.g., `UserRole`)

### 1.3 Function Guidelines
```typescript
// ✅ DO: Single responsibility, clear purpose
async function createTenant(data: CreateTenantInput): Promise<Tenant> {
  validateTenantData(data);
  const tenant = await db.tenants.create({ data });
  await auditLog('tenant.created', { tenantId: tenant.id });
  return tenant;
}

// ❌ DON'T: Multiple responsibilities
async function createTenant(data: any) {
  // validation, creation, email, audit, billing all mixed
}
```

---

## 2. Multi-Tenant Architecture Standards

### 2.1 Tenant Context (CRITICAL)
```typescript
// ✅ DO: Always validate tenant context
import { getTenantContext } from '@/lib/tenant-context';

async function getMatches(userId: string) {
  const { tenantId, role } = await getTenantContext(userId);
  return db.matches.findMany({
    where: { tenantId }
  });
}

// ❌ DON'T: Trust client-provided tenant ID
async function getMatches(tenantId: string) {
  return db.matches.findMany({ where: { tenantId } });
}
```

### 2.2 Database Queries
```typescript
// ✅ DO: Explicit tenant scoping
const matches = await db.matches.findMany({
  where: {
    tenantId: ctx.tenantId,
    status: 'active'
  }
});

// ❌ DON'T: Missing tenant filter
const matches = await db.matches.findMany({
  where: { status: 'active' }
});
```

---

## 3. API Route Standards

### 3.1 Next.js API Routes
```typescript
// ✅ DO: Proper error handling and validation
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email()
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = schema.parse(body);
    const result = await createUser(data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    console.error('User creation failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### 3.2 NestJS Controllers
```typescript
// ✅ DO: Use DTOs and decorators
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@/guards/auth.guard';

@Controller('matches')
@UseGuards(AuthGuard)
export class MatchesController {
  @Post()
  async create(@Body() dto: CreateMatchDto) {
    return this.matchesService.create(dto);
  }
}
```

---

## 4. Testing Standards

### 4.1 Unit Tests
```typescript
// ✅ DO: Test business logic thoroughly
describe('TenantService', () => {
  describe('createTenant', () => {
    it('should create tenant with valid data', async () => {
      const data = { name: 'Test League', ownerId: 'user-1' };
      const result = await service.createTenant(data);
      expect(result.id).toBeDefined();
      expect(result.name).toBe('Test League');
    });

    it('should reject duplicate tenant names', async () => {
      await expect(
        service.createTenant({ name: 'Existing', ownerId: 'user-1' })
      ).rejects.toThrow('Tenant name already exists');
    });

    it('should enforce tenant isolation', async () => {
      const tenant1 = await service.createTenant({...});
      const tenant2 = await service.createTenant({...});
      const matches1 = await getMatches(tenant1.id);
      expect(matches1).not.toContainEqual(
        expect.objectContaining({ tenantId: tenant2.id })
      );
    });
  });
});
```

### 4.2 Coverage Requirements
- **Services:** 80% minimum
- **Controllers:** 70% minimum
- **Utilities:** 90% minimum
- **Critical paths:** 100% (auth, billing, scoring)

---

## 5. Error Handling

### 5.1 Custom Error Classes
```typescript
// ✅ DO: Use typed errors
export class TenantNotFoundError extends Error {
  constructor(tenantId: string) {
    super(`Tenant not found: ${tenantId}`);
    this.name = 'TenantNotFoundError';
  }
}

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}
```

### 5.2 Error Handling Pattern
```typescript
// ✅ DO: Handle errors gracefully
try {
  const tenant = await getTenant(id);
  if (!tenant) throw new TenantNotFoundError(id);
  return tenant;
} catch (error) {
  if (error instanceof TenantNotFoundError) {
    return { error: error.message, status: 404 };
  }
  logger.error('Unexpected error:', error);
  return { error: 'Internal server error', status: 500 };
}
```

---

## 6. Security Standards

### 6.1 Input Validation
```typescript
// ✅ DO: Validate all inputs
import { z } from 'zod';

const CreateMatchSchema = z.object({
  tenantId: z.string().uuid(),
  homeTeamId: z.string().uuid(),
  awayTeamId: z.string().uuid(),
  scheduledAt: z.string().datetime()
});

// ❌ DON'T: Trust raw inputs
function createMatch(data: any) {
  return db.matches.create({ data });
}
```

### 6.2 Authentication & Authorization
```typescript
// ✅ DO: Check permissions
async function updateMatch(matchId: string, userId: string, data: any) {
  const { tenantId, role } = await getTenantContext(userId);
  const match = await db.matches.findUnique({
    where: { id: matchId, tenantId }
  });

  if (!match) throw new NotFoundError();
  if (!canUpdateMatch(role)) throw new UnauthorizedError();

  return db.matches.update({ where: { id: matchId }, data });
}
```

---

## 7. Performance Standards

### 7.1 Database Queries
```typescript
// ✅ DO: Use indexes and pagination
const matches = await db.matches.findMany({
  where: { tenantId },
  include: { homeTeam: true, awayTeam: true },
  orderBy: { scheduledAt: 'desc' },
  take: 20,
  skip: page * 20
});

// ❌ DON'T: Load everything
const matches = await db.matches.findMany({
  include: { homeTeam: true, awayTeam: true, players: true, ... }
});
```

### 7.2 Caching
```typescript
// ✅ DO: Cache expensive operations
import { cache } from '@/lib/cache';

async function getLeagueStats(tenantId: string) {
  const cacheKey = `league:stats:${tenantId}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const stats = await calculateStats(tenantId);
  await cache.set(cacheKey, stats, { ttl: 300 });
  return stats;
}
```

---

## 8. Git Commit Standards

### 8.1 Commit Message Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance

**Examples:**
```
feat(auth): add multi-tenant authentication

- Implement tenant context middleware
- Add tenant validation to all routes
- Update tests for tenant isolation

Closes #123
```

---

## 9. Code Review Checklist

- [ ] Type safety (no `any` types)
- [ ] Tenant isolation enforced
- [ ] Input validation present
- [ ] Error handling implemented
- [ ] Tests added/updated
- [ ] No console.logs (use logger)
- [ ] No hardcoded values
- [ ] Performance considered
- [ ] Security reviewed
- [ ] Documentation updated

---

## 10. File Structure Standards

```
services/
  auth-service/
    src/
      controllers/
      services/
      dto/
      guards/
      utils/
      __tests__/
    package.json
    tsconfig.json
    jest.config.js

apps/
  web/
    src/
      app/
        api/
        (routes)/
      components/
      lib/
      hooks/
      types/
    package.json
    next.config.js
```

---

**Enforcement:** All PRs must pass ESLint, Prettier, and type checking before merge.
