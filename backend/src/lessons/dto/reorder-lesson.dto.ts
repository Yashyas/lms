import { IsArray, IsNotEmpty, IsNumber, IsString } from "class-validator";

export class ReorderLessonDto {
    @IsArray()
    @IsString({ each: true })
    @IsNotEmpty()
    lessonIds: string[];
}