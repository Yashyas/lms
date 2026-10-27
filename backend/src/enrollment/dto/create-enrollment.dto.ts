import { IsNotEmpty, IsString } from "class-validator";

export class CreateEnrollmentDto {
    @IsNotEmpty()
    @IsString()
    courseId: string;

}
