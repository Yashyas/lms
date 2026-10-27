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

    // auto calc position 
    let position = createLessonDto.position
    if (position === undefined || position === null) {
      const lastLesson = await this.db.forUser(user).lesson.findFirst({
        where: { courseId: courseId },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      position = (lastLesson?.position ?? 0) + 1
    }
    // lesson create 
    const lesson = await this.db.forUser(user).lesson.create({
      data: {
        title: createLessonDto.title,
        content: createLessonDto.content,
        videoUrl: createLessonDto.videoUrl,
        isFree: createLessonDto.isFree,
        position: position,
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
    if (!lesson) {
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
  async reorder(reorderLessonDto: ReorderLessonDto, user: AuthUser) {
    return await this.db.forUser(user).$transaction(async (tx) => {
      const updates = reorderLessonDto.lessonIds.map((lessonId, index) =>
        tx.lesson.update({
          where: { id: lessonId },
          data: { position: index + 1 },
        })
      );
      return await Promise.all(updates);
    });
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
