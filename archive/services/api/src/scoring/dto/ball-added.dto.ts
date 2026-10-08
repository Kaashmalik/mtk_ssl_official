import { IsNotEmpty, IsObject, IsString } from "class-validator";

export class BallAddedDto {
  @IsString()
  @IsNotEmpty()
  matchId: string;

  @IsObject()
  ballData: Record<string, unknown>;
}