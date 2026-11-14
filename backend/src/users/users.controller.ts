import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { AllowAnonymous, Roles, Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { Throttle } from '@nestjs/throttler';
import { UsersService } from './users.service.js';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto.js';
import { GetAvatarUploadUrlDto } from './dto/avatar-upload.dto.js';
import { AssignInstructorDto } from './dto/assign-instructor.dto.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  /**
   * Get current logged-in user profile and stats
   */
  @Get('me')
  getMe(@Session() session: UserSession) {
    return this.usersService.getMe(session.user);
  }

  /**
   * Update profile (name, headline, bio, avatar)
   */
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Patch('me')
  updateMe(
    @Body() dto: UpdateUserProfileDto,
    @Session() session: UserSession,
  ) {
    return this.usersService.updateMe(dto, session.user);
  }

  /**
   * Generate presigned S3 upload URL for avatar image (Max 10 per min)
   */
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('avatar-upload-url')
  getAvatarUploadUrl(
    @Body() dto: GetAvatarUploadUrlDto,
    @Session() session: UserSession,
  ) {
    return this.usersService.getAvatarUploadUrl(dto, session.user);
  }

  /**
   * Assign instructor role to a user by email (Admin only, Max 10 per min)
   */
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Roles(['admin'])
  @Post('admin/assign-instructor')
  assignInstructor(
    @Body() dto: AssignInstructorDto,
    @Session() session: UserSession,
  ) {
    return this.usersService.assignInstructorByEmail(dto, session.user);
  }

  /**
   * Get public instructor profile and their published courses
   */
  @Get('instructors/:id')
  @AllowAnonymous()
  getInstructorProfile(@Param('id') id: string) {
    return this.usersService.getInstructorProfile(id);
  }
}
