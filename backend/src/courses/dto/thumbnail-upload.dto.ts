import { IsNotEmpty, IsString, Matches } from "class-validator";

export class GetThumbnailUploadDto {
    @IsString()
    @IsNotEmpty()
    fileName: string

    @IsString()
    @IsNotEmpty()
    @Matches(/^image\/(jpeg|png|webp|gif|svg\+xml)$/, { message: 'contentType must be a valid image (jpeg, png, webp, gif, svg+xml)' })
    contentType: string
}