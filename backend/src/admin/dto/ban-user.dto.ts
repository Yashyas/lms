import { IsOptional, IsString, IsInt, Min, Max, MaxLength } from 'class-validator';

export class BanUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  banReason?: string;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(315360000)
  banExpiresIn?: number;
}

