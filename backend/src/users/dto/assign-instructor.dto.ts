import { IsEmail, IsNotEmpty } from 'class-validator';

export class AssignInstructorDto {
  @IsEmail({}, { message: 'Must be a valid email address' })
  @IsNotEmpty({ message: 'Email address is required' })
  email: string;
}

