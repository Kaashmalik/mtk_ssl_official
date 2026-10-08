import { ApiProperty } from "@nestjs/swagger";

export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: "BAD_REQUEST" })
  errorCode: string;

  @ApiProperty({ example: "Validation failed" })
  message: string;

  @ApiProperty({ example: "f9a4d7e2-1f5a-4e3c-9a3d-8b1a1f92a9c1" })
  requestId: string;

  @ApiProperty({ example: "2026-05-28T12:00:00.000Z" })
  timestamp: string;

  @ApiProperty({ example: "/api/tenants" })
  path: string;
}