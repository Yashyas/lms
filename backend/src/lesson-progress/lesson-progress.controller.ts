import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { LessonProgressService } from './lesson-progress.service.js';
import { CreateLessonProgressDto } from './dto/create-lesson-progress.dto.js';
import { UpdateLessonProgressDto } from './dto/update-lesson-progress.dto.js';

@Controller('lesson-progress')
export class LessonProgressController {
  constructor(private readonly lessonProgressService: LessonProgressService) {}

  @Post()
  create(@Body() createLessonProgressDto: CreateLessonProgressDto) {
    return this.lessonProgressService.create(createLessonProgressDto);
  }

  @Get()
  findAll() {
    return this.lessonProgressService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.lessonProgressService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateLessonProgressDto: UpdateLessonProgressDto) {
    return this.lessonProgressService.update(+id, updateLessonProgressDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.lessonProgressService.remove(+id);
  }
}
