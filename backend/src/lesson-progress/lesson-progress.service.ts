import { Injectable, NotFoundException } from '@nestjs/common';
import { RecordHeartbeatDto } from './dto/record-heartbeat.dto.js';
import { AuthUser, DbPoolService } from '../db-pool/db-pool.service.js';

@Injectable()
export class LessonProgressService {
  constructor(private readonly db: DbPoolService) { }

  async recordHeartbeat(recordHeartbeatDto: RecordHeartbeatDto, user: AuthUser, lessonId: string) {
    // find lesson and check if user is enrolled in the course
    // will be sending it once every minute to reduce backend loads 
    const lesson = await this.db.forUser(user).lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, courseId: true },
    });

    if (!lesson) {
      throw new NotFoundException('Lesson not found or you are not enrolled');
    }

    // Check 90% completion threshold
    const COMPLETION_THRESHOLD = 0.90;
    const shouldMarkCompleted =
      recordHeartbeatDto.duration > 0 &&
      recordHeartbeatDto.lastPlayedSecond / recordHeartbeatDto.duration >= COMPLETION_THRESHOLD;

    // Upsert progress (never un-complete an already completed lesson)
    const progress = await this.db.forUser(user).lessonProgress.upsert({
      where: {
        userId_lessonId: {
          userId: user.id,
          lessonId: lessonId,
        },
      },
      create: {
        userId: user.id,
        lessonId: lessonId,
        lastPlayedSeconds: Math.floor(recordHeartbeatDto.lastPlayedSecond),
        completed: shouldMarkCompleted,
        completedAt: shouldMarkCompleted ? new Date() : null,
      },
      update: {
        lastPlayedSeconds: Math.floor(recordHeartbeatDto.lastPlayedSecond),
        ...(shouldMarkCompleted
          ? { completed: true, completedAt: new Date() }
          : {}),
      },
    });

    return progress;
  }

  //  get lesson watch progress 
  async getLessonProgress(lessonId: string, user: AuthUser) {
    const progress = await this.db.forUser(user).lessonProgress.findUnique({
      where: {
        userId_lessonId: {
          userId: user.id,
          lessonId: lessonId,
        },
      },
    });

    if (!progress) {
      return {
        lessonId,
        lastPlayedSeconds: 0,
        completed: false,
        completedAt: null,
      };
    }

    return progress;
  }

  // Manually toggles lesson completion status 
  async toggleLessonComplete(lessonId: string, user: AuthUser) {
    //  check if lesson exist for this user
    const lesson = await this.db.forUser(user).lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, courseId: true },
    });

    if (!lesson) {
      throw new NotFoundException('Lesson not found or you are not enrolled');
    }

    // check if progress already exists
    const existing = await this.db.forUser(user).lessonProgress.findUnique({
      where: {
        userId_lessonId: {
          userId: user.id,
          lessonId: lessonId,
        },
      },
    });

    if (!existing) {
      return await this.db.forUser(user).lessonProgress.create({
        data: {
          userId: user.id,
          lessonId: lessonId,
          lastPlayedSeconds: 0,
          completed: true,
          completedAt: new Date(),
        },
      });
    }

    const nextCompleted = !existing.completed;
    return await this.db.forUser(user).lessonProgress.update({
      where: { id: existing.id },
      data: {
        completed: nextCompleted,
        completedAt: nextCompleted ? new Date() : null,
      },
    });
  }

  // get course progress 
  // Aggregates completion percentage, completed lesson IDs, and the next unwatched lesson.
  async getCourseProgress(courseId: string, user: AuthUser) {
    //  Fetch all lessons in course ordered by position
    const lessons = await this.db.forUser(user).lesson.findMany({
      where: { courseId },
      orderBy: { position: 'asc' },
      select: { id: true, title: true, position: true },
    });

    if (!lessons.length) {
      return {
        totalLessons: 0,
        completedLessons: 0,
        percentage: 0,
        isCompleted: false,
        nextLessonId: null,
        completedLessonIds: [],
      };
    }

    // Fetch completed progress records
    const progressRecords = await this.db.forUser(user).lessonProgress.findMany({
      where: {
        lessonId: { in: lessons.map((l) => l.id) },
        completed: true,
      },
      select: { lessonId: true },
    });

    const completedLessonIds = progressRecords.map((p) => p.lessonId);
    const completedSet = new Set(completedLessonIds);

    const totalLessons = lessons.length;
    const completedLessons = completedLessonIds.length;
    const percentage = Math.round((completedLessons / totalLessons) * 100);

    // Find next unwatched lesson
    const nextLesson = lessons.find((l) => !completedSet.has(l.id)) || lessons[0];

    return {
      totalLessons,
      completedLessons,
      percentage,
      isCompleted: percentage === 100,
      nextLessonId: nextLesson?.id ?? null,
      completedLessonIds,
    };
  }
}

