import { IsOptional, IsString, IsIn, IsInt, Min, Max, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class AdminUsersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsIn(['student', 'instructor', 'admin'])
  role?: string;

  @IsOptional()
  @IsIn(['active', 'banned'])
  status?: 'active' | 'banned';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

