import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthUser, DbPoolService } from '../db-pool/db-pool.service.js';

@Injectable()
export class EnrollmentService {
  constructor(private readonly db: DbPoolService) { }

  // Enroll current student into a course
  async enroll(courseId: string, user: AuthUser) {
    // Check if course exists and is published
    const course = await this.db.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        published: true,
        title: true,
        instructorId: true,
      },
    });

    if (!course) throw new NotFoundException('Course not found');
    if (!course.published) throw new BadRequestException('Course is not published');
    if (course.instructorId === user.id) {
      throw new BadRequestException('Instructors cannot enroll in their own courses');
    }

    //Check if user is already enrolled
    const existingEnrollment = await this.db.forUser(user).enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId } },
      select: { id: true },
    });

    if (existingEnrollment) {
      throw new ConflictException('You are already enrolled in this course');
    }

    // Create enrollment for user
    const newEnrollment = await this.db.forUser(user).enrollment.create({
      data: {
        userId: user.id,
        courseId: courseId,
      },
      include: {
        course: {
          select: { id: true, title: true, slug: true },
        },
      },
    });

    return {
      message: `Successfully Enrolled in ${newEnrollment.course.title}`,
      newEnrollment,
    };
  }

  // Get all courses enrolled by the authenticated user
  async findMyEnrollments(user: AuthUser) {
    const enrollments = await this.db.forUser(user).enrollment.findMany({
      where: { userId: user.id },
      include: {
        course: {
          include: {
            instructor: { select: { id: true, name: true, image: true } },
            _count: { select: { lessons: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return enrollments;
  }

  // Check enrollment status of student for a specific course
  async checkStatus(courseId: string, user: AuthUser) {
    const existingEnrollment = await this.db.forUser(user).enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId } },
      select: { id: true, createdAt: true },
    });

    return {
      isEnrolled: !!existingEnrollment,
      enrolledAt: existingEnrollment?.createdAt || null,
    };
  }

  // Find all student enrollments in a specific course (instructor or admin)
  async findAllEnrolmentsByCourse(courseId: string, user: AuthUser) {
    const course = await this.db.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        instructorId: true,
      },
    });

    if (!course) throw new NotFoundException('Course not found');

    if (course.instructorId !== user.id && user.role !== 'admin') {
      throw new ForbiddenException('You are not authorized to view enrollments for this course');
    }

    const enrollments = await this.db.forUser(user).enrollment.findMany({
      where: { courseId },
      include: {
        user: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return enrollments;
  }

  // Remove / unenroll a student from a course
  async remove(id: string, user: AuthUser) {
    const enrollment = await this.db.forUser(user).enrollment.findUnique({
      where: { id },
    });

    if (!enrollment) throw new NotFoundException('Enrollment not found');

    if (enrollment.userId !== user.id && user.role !== 'admin') {
      throw new ForbiddenException('You are not authorized to remove this enrollment');
    }

    const deletedEnrollment = await this.db.forUser(user).enrollment.delete({
      where: { id },
    });

    return { message: 'Enrollment deleted successfully', deletedEnrollment };
  }
}
