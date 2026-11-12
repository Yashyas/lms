import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserProfileDto {
  @ApiPropertyOptional({ example: 'John Doe', description: 'User display name' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: 'Senior Backend Architect',
    description: 'Short headline or current title',
  })
  @IsString()
  @IsOptional()
  @MaxLength(256)
  headline?: string;

  @ApiPropertyOptional({
    example: '10+ years designing distributed cloud architectures and microservices.',
    description: 'Detailed user biography',
  })
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

