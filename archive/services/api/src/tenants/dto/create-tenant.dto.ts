import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsHexColor,
  IsUrl,
  Matches,
} from "class-validator";

/**
 * DTO for creating a new tenant/league
 */
export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, {
    message: "slug must contain only lowercase letters, numbers, and hyphens",
  })
  slug: string;

  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9-]+$/, {
    message: "subdomain must contain only lowercase letters, numbers, and hyphens",
  })
  subdomain?: string;

  @IsString()
  @IsOptional()
  @Matches(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i, {
    message: "customDomain must be a valid domain",
  })
  customDomain?: string;

  @IsString()
  @IsOptional()
  @IsUrl({ require_tld: false })
  logo?: string;

  @IsString()
  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsBoolean()
  @IsOptional()
  isWhiteLabel?: boolean;

  @IsString()
  @IsNotEmpty()
  ownerId: string; // Clerk user ID
}

