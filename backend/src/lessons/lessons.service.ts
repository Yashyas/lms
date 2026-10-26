import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { CreateLessonDto } from './dto/create-lesson.dto.js';
import { UpdateLessonDto } from './dto/update-lesson.dto.js';
import { ReorderLessonDto } from './dto/reorder-lesson.dto.js';
import { AuthUser, DbPoolService } from '../db-pool/db-pool.service.js';

@Injectable()
export class LessonsService {
  constructor(
    private readonly db: DbPoolService
  ) { }

  // create lesson for a course 
  async create(createLessonDto: CreateLessonDto, courseId: string, user: AuthUser) {
    const lesson = await this.db.forUser(user).lesson.create({
      data: {
        title: createLessonDto.title,
        content: createLessonDto.content,
        videoUrl: createLessonDto.videoUrl,
        isFree: createLessonDto.isFree,
        position: createLessonDto.position,
        courseId: courseId,
      }
    })
    if (!lesson.id) {
      throw new InternalServerErrorException("Unable to create the lesson");
    }
    return lesson;
  }

  // find a course content 
  async findOne(id: string, user: AuthUser) {
    const lesson = await this.db.forUser(user).lesson.findUnique({
      where: { id: id },
    })
    if (!lesson.id) {
      throw new NotFoundException("Unable to find the lesson");
    }
    return lesson;
  }

  // update a lesson 
  async update(id: string, updateLessonDto: UpdateLessonDto, user: AuthUser) {
    const lesson = await this.db.forUser(user).lesson.update({
      where: { id: id },
      data: updateLessonDto,
    })
    return lesson;
  }

  // reorder lessons of a course 
  async reorder(courseId: string, reorderLessonDto: ReorderLessonDto, user: AuthUser) {
    const lesson = await this.db.forUser(user).lesson.update({
      where: { id: reorderLessonDto.lessonId },
      data: {
        position: reorderLessonDto.position,
      },
    })
    return lesson;
  }

  // delete a lesson 
  async remove(id: string, user: AuthUser) {
    const lesson = await this.db.forUser(user).lesson.findUnique({
      where: { id: id },
    })
    if (!lesson) {
      throw new NotFoundException("Unable to find the lesson");
    }
    const deletedCourse = await this.db.forUser(user).lesson.delete({
      where: { id: id },
    })
    return deletedCourse;
  }
}
