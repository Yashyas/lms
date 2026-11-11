import { IsNotEmpty, IsNumber, Min } from "class-validator";

export class RecordHeartbeatDto {
    @IsNumber()
    @IsNotEmpty()
    @Min(0)
    lastPlayedSecond: number;

    @IsNumber()
    @IsNotEmpty()
    @Min(1)
    duration: number;
}