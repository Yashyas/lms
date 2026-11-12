import { IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GetAvatarUploadUrlDto {
  @ApiPropertyOptional({ example: 'profile.png', description: 'Original file name' })
  @IsString()
  @IsOptional()
  fileName?: string;

  @ApiProperty({
    example: 'image/webp',
    description: 'Image MIME type (image/jpeg, image/png, image/webp)',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^image\/(jpeg|png|webp)$/, {
    message: 'contentType must be a valid image MIME type (jpeg, png, or webp)',
  })
  contentType: string;

  @ApiProperty({
    example: 1048576,
    description: 'File size in bytes (max 5MB)',
  })
  @IsNumber({}, { message: 'fileSize must be a valid number of bytes' })
  @IsNotEmpty({ message: 'fileSize is required' })
  @Min(1, { message: 'File size must be greater than 0' })
  @Max(5 * 1024 * 1024, { message: 'Avatar image must not exceed 5MB' })
  fileSize: number;
}

