import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Length } from "class-validator";

export class CreateLessonDto {
    @IsString()
    @Length(1, 256)
    @IsNotEmpty()
    title: string;

    @IsString()
    @IsNotEmpty()
    @IsOptional()
    content?: string;

    @IsString()
    @IsOptional()
    videoUrl?: string;

    @IsBoolean()
    @IsOptional()
    isFree?: boolean;

    @IsNumber()
    @IsOptional()
    position?: number;
}
