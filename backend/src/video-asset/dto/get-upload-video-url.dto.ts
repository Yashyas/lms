import { IsIn, IsNotEmpty, IsString } from "class-validator";

export class GetUploadVideoUrlDto {
    @IsString()
    @IsNotEmpty()
    lessonId: string

    @IsString()
    @IsNotEmpty()
    fileName: string

    @IsString()
    @IsNotEmpty()
    @IsIn(['video/mp4', 'video/quicktime', 'video/mpeg', 'video/webm', 'video/x-matroska'])
    contentType: string
}
