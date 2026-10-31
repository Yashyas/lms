import { IsNotEmpty, IsString } from "class-validator";

export class GetUploadVideoUrlDto {
    @IsString()
    @IsNotEmpty()
    lessonId: string

    @IsString()
    @IsNotEmpty()
    fileName: string

    @IsString()
    @IsNotEmpty()
    contentType: string
}
