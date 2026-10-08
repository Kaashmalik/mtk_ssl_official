import { ApiProperty } from "@nestjs/swagger";

export class TenantDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  ownerId: string;

  @ApiProperty({ required: false, nullable: true })
  customDomain?: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;
}

export class TenantResponseDto {
  @ApiProperty()
  message: string;

  @ApiProperty({ type: TenantDto })
  data: TenantDto;
}

export class TenantsResponseDto {
  @ApiProperty()
  message: string;

  @ApiProperty({ type: TenantDto, isArray: true })
  data: TenantDto[];
}