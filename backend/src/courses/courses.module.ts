import { Module } from '@nestjs/common';
import { CoursesService } from './courses.service.js';
import { CoursesController } from './courses.controller.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [StorageModule],
  controllers: [CoursesController],
  providers: [CoursesService],
  exports: [CoursesService],
})
export class CoursesModule { }
