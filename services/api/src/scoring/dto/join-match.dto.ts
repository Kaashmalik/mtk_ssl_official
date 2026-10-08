import { IsNotEmpty, IsString } from "class-validator";

export class JoinMatchDto {
  @IsString()
  @IsNotEmpty()
  matchId: string;
}