import { Controller, Get, Post, Body, Patch, Param, Delete, Put } from '@nestjs/common';
import { LessonsService } from './lessons.service.js';
import { CreateLessonDto } from './dto/create-lesson.dto.js';
import { UpdateLessonDto } from './dto/update-lesson.dto.js';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { ReorderLessonDto } from './dto/reorder-lesson.dto.js';

@Controller('lessons')
export class LessonsController {
  constructor(private readonly lessonsService: LessonsService) { }

  /**
   * Create lesson
   */
  @Post('courses/:courseId')
  create(@Body() createLessonDto: CreateLessonDto, @Param('courseId') courseId: string, @Session() session: UserSession) {
    return this.lessonsService.create(createLessonDto, courseId, session.user);
  }

  /**
   * Fetch a lesson details by id for users only if user is enrolled in the course
   */
  @Get(':id')
  findOne(@Param('id') id: string, @Session() session: UserSession) {
    return this.lessonsService.findOne(id, session.user);
  }

  /**
   * Update lesson details (only instructor and admin)
   */
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateLessonDto: UpdateLessonDto, @Session() session: UserSession) {
    return this.lessonsService.update(id, updateLessonDto, session.user);
  }

  /**
   * Reorder lesson positions (only instructor and admin)
   */
  @Put('reorder')
  reorder(@Body() reorderLessonDto: ReorderLessonDto, @Session() session: UserSession) {
    return this.lessonsService.reorder(reorderLessonDto, session.user);
  }

  /**
   * Delete lesson (only instructor and admin)
   */
  @Delete(':id')
  remove(@Param('id') id: string, @Session() session: UserSession) {
    return this.lessonsService.remove(id, session.user);
  }
}
