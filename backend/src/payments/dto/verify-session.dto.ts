import { IsNotEmpty, IsString } from "class-validator";

export class VerifySessionDto {
    @IsString()
    @IsNotEmpty()
    sessionId: string
}
