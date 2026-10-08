import { IsNotEmpty, IsString } from "class-validator";

export class BallUndoDto {
  @IsString()
  @IsNotEmpty()
  matchId: string;

  @IsString()
  @IsNotEmpty()
  ballId: string;
}