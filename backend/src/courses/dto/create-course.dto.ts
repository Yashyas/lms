import { IsNotEmpty, IsOptional, IsString, MinLength, IsInt, Min, MaxLength, IsBoolean, IsUrl } from 'class-validator';
export class CreateCourseDto {
    @IsString()
    @IsNotEmpty()
    @MinLength(3)
    @MaxLength(256)
    title: string;

    @IsString()
    @IsOptional()
    slug?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsString()
    @IsOptional()
    thumbnail?: string;

    @IsInt()
    @Min(0)
    price: number;

}
