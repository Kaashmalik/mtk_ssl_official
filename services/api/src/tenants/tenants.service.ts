import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { CreateTenantDto } from "./dto/create-tenant.dto";
import { db, tenants } from "@mtk/database";
import { eq } from "drizzle-orm";

/**
 * Tenants service
 * Business logic for tenant/league management
 */
@Injectable()
export class TenantsService {
  async findAll() {
    const data = await db.select().from(tenants).orderBy(tenants.createdAt);
    return {
      message: "Get all tenants",
      data,
    };
  }

  async findOne(id: string) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);
    return {
      message: `Get tenant ${id}`,
      data: tenant,
    };
  }

  async create(createTenantDto: CreateTenantDto) {
    const [existingSlug] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, createTenantDto.slug))
      .limit(1);

    if (existingSlug) {
      throw new ConflictException("Slug already exists");
    }

    const [tenant] = await db
      .insert(tenants)
      .values({
        name: createTenantDto.name,
        slug: createTenantDto.slug,
        ownerId: createTenantDto.ownerId,
        customDomain: null,
        isActive: true,
      })
      .returning();

    return {
      message: "Create tenant",
      data: tenant,
    };
  }
}

