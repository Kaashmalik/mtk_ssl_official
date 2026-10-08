import { IsNotEmpty, IsString } from "class-validator";

export class LeaveMatchDto {
  @IsString()
  @IsNotEmpty()
  matchId: string;
}