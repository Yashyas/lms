import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CoursesService } from './courses.service.js';
import { CreateCourseDto } from './dto/create-course.dto.js';
import { UpdateCourseDto } from './dto/update-course.dto.js';
import { AllowAnonymous, Session, type UserSession } from '@thallesp/nestjs-better-auth';

@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) { }

  // Get all courses for public 
  @Get()
  @AllowAnonymous()
  findAll() {
    return this.coursesService.findAll();
  }

  // Get instructors courses 
  @Get('instructor/courses')
  findInstructorCourses(@Session() session: UserSession) {
    return this.coursesService.findInstructorCourses(session.user);
  }

  // Get courses details by Slug for course detail page
  @Get('slug/:slug')
  @AllowAnonymous()
  findBySlug(@Param('slug') slug: string) {
    return this.coursesService.findBySlug(slug);
  }


  // create course only instructor and admin can create course 
  @Post()
  create(@Session() session: UserSession, @Body() createCourseDto: CreateCourseDto) {
    return this.coursesService.create(createCourseDto, session.user);
  }

  // get course by id 
  @Get(':id')
  findOne(@Param('id') id: string, @Session() session: UserSession) {
    return this.coursesService.findOne(id, session.user);
  }

  // update course only instructor and admin can update course
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCourseDto: UpdateCourseDto, @Session() session: UserSession) {
    return this.coursesService.update(id, updateCourseDto, session.user);
  }

  // toggle publish status 
  @Patch('publish/:id')
  togglePublish(@Param('id') id: string, @Session() session: UserSession) {
    return this.coursesService.togglePublish(id, session.user);
  }

  // delete course only instructor and admin can delete course
  @Delete(':id')
  remove(@Param('id') id: string, @Session() session: UserSession) {
    return this.coursesService.remove(id, session.user);
  }
}
