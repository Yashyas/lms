import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { LessonProgressService } from './lesson-progress.service.js';
import { RecordHeartbeatDto } from './dto/record-heartbeat.dto.js';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';


@Controller('lesson-progress')
export class LessonProgressController {
  constructor(private readonly lessonProgressService: LessonProgressService) { }

  @Post('heartbeat/:lessonId')
  recordHeartbeat(@Body() recordHeartbeatDto: RecordHeartbeatDto, @Param('lessonId') lessonId: string, @Session() session: UserSession) {
    return this.lessonProgressService.recordHeartbeat(recordHeartbeatDto, session.user, lessonId);
  }

  @Get(':lessonId')
  findOne(@Param('lessonId') lessonId: string, @Session() session: UserSession) {
    return this.lessonProgressService.getLessonProgress(lessonId, session.user);
  }

  @Patch(':lessonId/complete')
  update(@Param('lessonId') lessonId: string, @Session() session: UserSession) {
    return this.lessonProgressService.toggleLessonComplete(lessonId, session.user);
  }

  @Get('course/:courseId/progress')
  getCourseProgress(@Param('courseId') courseId: string, @Session() session: UserSession) {
    return this.lessonProgressService.getCourseProgress(courseId, session.user);
  }
}
