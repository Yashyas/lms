import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { CreateCourseDto } from './dto/create-course.dto.js';
import { UpdateCourseDto } from './dto/update-course.dto.js';
// import { UserSession } from '@thallesp/nestjs-better-auth';
import { AuthUser, DbPoolService } from '../db-pool/db-pool.service.js';
import { StorageService } from '../storage/storage.service.js';
import { GetThumbnailUploadDto } from './dto/thumbnail-upload.dto.js';

@Injectable()
export class CoursesService {
  constructor(
    private readonly db: DbPoolService,
    private readonly storageService: StorageService,
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
        thumbnail: createCourseDto.thumbnail,
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

  async getThumbnailUploadUrl(courseId: string, thumbnailUploadDto: GetThumbnailUploadDto, user: AuthUser) {
    // check if course exists for this instructor
    const course = await this.db.forUser(user).course.findUnique({
      where: { id: courseId },
      select: { id: true, instructorId: true },
    });

    if (!course) {
      throw new NotFoundException('Course not found or you are not authorized');
    }

    // check if user is instructor or admin 
    if (course.instructorId !== user.id && user.role !== 'admin') {
      throw new ForbiddenException('You are not authorized to upload thumbnail for this course');
    }

    // generate unique S3 key using MIME mapping to prevent extension spoofing
    const MIME_TO_EXT: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const cleanExtension = MIME_TO_EXT[thumbnailUploadDto.contentType] || 'webp';
    const key = `thumbnails/courses/${course.id}/${crypto.randomUUID()}.${cleanExtension}`;

    // generate presigned PUT URL (valid for 15 mins, with content-length if supplied)
    const uploadUrl = await this.storageService.getUploadPresignedUrl(
      key,
      thumbnailUploadDto.contentType,
      900,
      thumbnailUploadDto.fileSize,
    );

    // construct public url
    const publicUrl = this.storageService.getPublicUrl(key);

    return {
      uploadUrl,
      publicUrl,
      key,
    };
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
    const courseThumbnailPrefix = `thumbnails/courses/${id}/`;

    // when updating thumbnail, fetch the existing one to delete it
    if (updateCourseDto.thumbnail) {
      const newKey = this.storageService.getKeyFromUrl(updateCourseDto.thumbnail);
      if (!newKey || !newKey.startsWith(courseThumbnailPrefix)) {
        throw new ForbiddenException(
          'Course thumbnail must be uploaded through the course thumbnail upload endpoint',
        );
      }

      const existing = await this.db.forUser(user).course.findUnique({
        where: { id },
        select: { thumbnail: true },
      });

      // If attaching a new thumbnail, authoritatively verify its presence and size in S3
      if (existing?.thumbnail !== updateCourseDto.thumbnail) {
        await this.storageService.verifyUploadedObject(newKey, 10 * 1024 * 1024, [
          'image/jpeg',
          'image/png',
          'image/webp',
        ]);
      }

      if (existing?.thumbnail && existing.thumbnail !== updateCourseDto.thumbnail) {
        const oldKey = this.storageService.getKeyFromUrl(existing.thumbnail);
        if (oldKey && oldKey.startsWith(courseThumbnailPrefix)) {
          await this.storageService.deleteFile(oldKey);
        }
      }
    }

    // update course
    return await this.db.forUser(user).course.update({
      where: { id },
      data: updateCourseDto,
    });
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
      select: { id: true, thumbnail: true },
    })
    if (!course) {
      throw new NotFoundException("course not found")
    }

    // Delete thumbnail from S3 strictly within this course's thumbnail prefix
    if (course.thumbnail) {
      const courseThumbnailPrefix = `thumbnails/courses/${id}/`;
      const key = this.storageService.getKeyFromUrl(course.thumbnail);
      if (key && key.startsWith(courseThumbnailPrefix)) {
        await this.storageService.deleteFile(key);
      }
    }

    const deletedCourse = await this.db.forUser(user).course.delete({
      where: { id: id },
    })
    return deletedCourse
  }
}
