import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class UpdateUserProfileDto {
  @ApiPropertyOptional({ example: 'John Doe', description: 'User display name' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Name cannot be empty' })
  @MinLength(2, { message: 'Name must be at least 2 characters long' })
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: 'Senior Backend Architect',
    description: 'Short headline or current title',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsOptional()
  @MaxLength(256)
  headline?: string;

  @ApiPropertyOptional({
    example: '10+ years designing distributed cloud architectures and microservices.',
    description: 'Detailed user biography',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsOptional()
  @MaxLength(2048)
  bio?: string;

  @ApiPropertyOptional({
    example: 'http://localhost:3900/lms-media/avatars/user-123/avatar.webp',
    description: 'Public avatar image URL',
  })
  @IsString()
  @IsOptional()
  image?: string;
}

