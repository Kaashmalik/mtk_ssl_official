import { Controller, Get, Post, Body, Param } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { TenantsService } from "./tenants.service";
import { CreateTenantDto } from "./dto/create-tenant.dto";
import { TenantIdParamDto } from "./dto/tenant-id.param.dto";
import { ApiBadRequestResponse, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { TenantResponseDto, TenantsResponseDto } from "./dto/tenant-response.dto";
import { Roles } from "../common/decorators/roles.decorator";
import { RoleThrottle } from "../common/decorators/role-throttle.decorator";
import { ErrorResponseDto } from "../common/dto/error-response.dto";

/**
 * Tenants controller
 * Handles league/tenant CRUD operations
 */
@ApiTags("tenants")
@Controller("tenants")
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  @ApiOkResponse({ type: TenantsResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async findAll() {
    return this.tenantsService.findAll();
  }

  @Get(":id")
  @ApiOkResponse({ type: TenantResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async findOne(@Param() params: TenantIdParamDto) {
    return this.tenantsService.findOne(params.id);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @RoleThrottle({ admin: 60, owner: 30, user: 5 })
  @Roles("admin", "owner")
  @ApiOkResponse({ type: TenantResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  async create(@Body() createTenantDto: CreateTenantDto) {
    return this.tenantsService.create(createTenantDto);
  }
}

