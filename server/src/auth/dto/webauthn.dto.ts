import { IsArray, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class WebauthnLoginOptionsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  credIds?: string[];
}

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
