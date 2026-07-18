import { IsInt, Max, Min } from 'class-validator';

export class ApproveDto {
  @IsInt()
  @Min(1)
  @Max(6)
  level: number; // ۱..۶
}
