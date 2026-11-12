import { IsNotEmpty, IsNumber, IsString, Matches, Max, Min } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class GetThumbnailUploadDto {
    @ApiProperty({ example: 'thumb.png', description: 'Original file name' })
    @IsString()
    @IsNotEmpty()
    fileName: string;

    @ApiProperty({ example: 'image/webp', description: 'Image MIME type (jpeg, png, or webp)' })
    @IsString()
    @IsNotEmpty()
    @Matches(/^image\/(jpeg|png|webp)$/, { message: 'contentType must be a valid image (jpeg, png, or webp)' })
    contentType: string;

    @ApiProperty({ example: 1048576, description: 'File size in bytes (max 10MB)' })
    @IsNumber({}, { message: 'fileSize must be a valid number of bytes' })
    @IsNotEmpty({ message: 'fileSize is required' })
    @Min(1, { message: 'File size must be greater than 0' })
    @Max(10 * 1024 * 1024, { message: 'Course thumbnail must not exceed 10MB' })
    fileSize: number;
}