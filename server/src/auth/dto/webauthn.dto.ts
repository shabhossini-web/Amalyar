import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class WebauthnVerifyDto {
  @IsObject()
  response: any;

  @IsString()
  @MinLength(20)
  challengeToken: string;

  @IsOptional()
  @IsString()
  name?: string;
}
