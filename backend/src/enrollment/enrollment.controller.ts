import { Controller, Get, Post, Param, Delete } from '@nestjs/common';
import { EnrollmentService } from './enrollment.service.js';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';

@Controller('enrollment')
export class EnrollmentController {
  constructor(private readonly enrollmentService: EnrollmentService) { }

  /**
   * Enroll the current user into a course
   */
  @Post(':courseId')
  enroll(@Param('courseId') courseId: string, @Session() session: UserSession) {
    return this.enrollmentService.enroll(courseId, session.user);
  }

  /**
   * Get all enrollments for the logged in student
   */
  @Get('mine')
  findMyEnrollments(@Session() session: UserSession) {
    return this.enrollmentService.findMyEnrollments(session.user);
  }

  /**
   * Check enrollment status of logged in student for a specific course
   */
  @Get('status/:courseId')
  checkStatus(@Param('courseId') courseId: string, @Session() session: UserSession) {
    return this.enrollmentService.checkStatus(courseId, session.user);
  }

  /**
   * Get all student enrollments for a specific course (instructor and admin only)
   */
  @Get('course/:courseId')
  findAllEnrolmentsByCourse(@Param('courseId') courseId: string, @Session() session: UserSession) {
    return this.enrollmentService.findAllEnrolmentsByCourse(courseId, session.user);
  }

  /**
   * Delete or unenroll a course enrollment
   */
  @Delete(':id')
  remove(@Param('id') id: string, @Session() session: UserSession) {
    return this.enrollmentService.remove(id, session.user);
  }
}
