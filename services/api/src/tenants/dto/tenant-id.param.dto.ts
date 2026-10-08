import { IsNotEmpty, IsString } from "class-validator";

export class TenantIdParamDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}