import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { CreateCourseDto } from './dto/create-course.dto.js';
import { UpdateCourseDto } from './dto/update-course.dto.js';
// import { UserSession } from '@thallesp/nestjs-better-auth';
import { AuthUser, DbPoolService } from '../db-pool/db-pool.service.js';

@Injectable()
export class CoursesService {
  constructor(
    private readonly db: DbPoolService
  ) { }

  // create course 
  async create(createCourseDto: CreateCourseDto, user: AuthUser) {
    let slug = createCourseDto.slug;
    if (!slug) {
      const cleanTitle = createCourseDto.title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-');
      slug = `${cleanTitle}-${crypto.randomUUID().slice(0, 6)}`;
    }
    const course = await this.db.forUser(user).course.create({
      data: {
        title: createCourseDto.title,
        description: createCourseDto.description,
        price: createCourseDto.price,
        instructorId: user.id,
        slug: slug,
      },
    })
    if (!course.id) {
      throw new InternalServerErrorException("Unable to create the course")
    }
    return course
  }

  // get all published courses -- no need for pagination as the course will not exceed more than 20-30, will do search on frontend
  // in response send _count of lessons and enrollments
  async findAll() {
    return await this.db.client.course.findMany(
      {
        where: { published: true },
        include: {
          instructor: { select: { id: true, name: true, image: true } },
          _count: { select: { lessons: true, enrollments: true } }
        },
        orderBy: { createdAt: 'desc' }
      }
    )
  }

  // find a course detail by slug (for public / unauthenticated visitors)
  async findBySlug(slug: string) {
    const course = await this.db.client.course.findUnique({
      where: { slug: slug },
      include: {
        instructor: { select: { id: true, name: true, image: true } },
        lessons: {
          select: { title: true, id: true, position: true, isFree: true },
          orderBy: { position: 'asc' },
        },
        _count: { select: { enrollments: true } },
      },
    })
    if (!course || !course.published) {
      throw new NotFoundException("Course not found")
    }
    return course
  }

  // find all the courses of an instructor 
  async findInstructorCourses(user: AuthUser) {
    const courses = await this.db.forUser(user).course.findMany({
      where: {
        instructorId: user.id,
      },
      include: {
        _count: { select: { lessons: true, enrollments: true } }
      },
      orderBy: {
        createdAt: 'desc',
      },
    })
    return courses;
  }

  // find a course by id 
  async findOne(id: string, user: AuthUser) {
    const course = await this.db.forUser(user).course.findUnique({
      where: { id: id },
      include: {
        instructor: { select: { id: true, name: true, image: true } },
        lessons: { orderBy: { position: 'asc' } },
        enrollments: {
          where: { userId: user.id },
          select: { id: true, createdAt: true },
        },
        _count: { select: { lessons: true, enrollments: true } },
      },
    })
    if (!course) {
      throw new NotFoundException("Course not found")
    }
    const { enrollments, ...rest } = course
    return {
      ...rest,
      isEnrolled: enrollments ? enrollments.length > 0 : false,
    }
  }

  // update a course 
  async update(id: string, updateCourseDto: UpdateCourseDto, user: AuthUser) {
    const course = await this.db.forUser(user).course.update({
      where: { id: id },
      data: updateCourseDto,
    })
    return course
  }

  // toggle publish status of course 
  async togglePublish(id: string, user: AuthUser) {
    const course = await this.db.forUser(user).course.findUnique({
      where: { id: id },
      select: {
        published: true,
        lessons: { select: { id: true } }
      }
    })
    if (!course) {
      throw new NotFoundException("course not found")
    }
    if (!course.published && course.lessons.length === 0) {
      throw new BadRequestException("course must have at least one lesson to be published")
    }
    const updatedCourse = await this.db.forUser(user).course.update({
      where: { id: id },
      data: {
        published: !course.published,
      },
    })
    return updatedCourse
  }

  // delete a course 
  async remove(id: string, user: AuthUser) {
    const course = await this.db.forUser(user).course.findUnique({
      where: { id: id },
    })
    if (!course) {
      throw new NotFoundException("course not found")
    }
    const deletedCourse = await this.db.forUser(user).course.delete({
      where: { id: id },
    })
    return deletedCourse
  }
}
