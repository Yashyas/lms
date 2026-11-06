import { Injectable } from '@nestjs/common';
import { CreateLessonProgressDto } from './dto/create-lesson-progress.dto.js';
import { UpdateLessonProgressDto } from './dto/update-lesson-progress.dto.js';

@Injectable()
export class LessonProgressService {
  create(createLessonProgressDto: CreateLessonProgressDto) {
    return 'This action adds a new lessonProgress';
  }

  findAll() {
    return `This action returns all lessonProgress`;
  }

  findOne(id: number) {
    return `This action returns a #${id} lessonProgress`;
  }

  update(id: number, updateLessonProgressDto: UpdateLessonProgressDto) {
    return `This action updates a #${id} lessonProgress`;
  }

  remove(id: number) {
    return `This action removes a #${id} lessonProgress`;
  }
}
