import { IsNotEmpty, IsNumber, IsString } from "class-validator";

// it should be an array or something of shorts for rearranging , will look itno it in future 
export class ReorderLessonDto {
    @IsString()
    @IsNotEmpty()
    lessonId: string;

    @IsNumber()
    @IsNotEmpty()
    position: number;
}