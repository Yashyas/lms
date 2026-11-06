import { Module } from '@nestjs/common';
import { LessonProgressService } from './lesson-progress.service.js';
import { LessonProgressController } from './lesson-progress.controller.js';

@Module({
  controllers: [LessonProgressController],
  providers: [LessonProgressService],
})
export class LessonProgressModule {}
