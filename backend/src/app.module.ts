import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DbPoolModule } from './db-pool/db-pool.module.js';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './auth/auth.js';
import { CoursesModule } from './courses/courses.module.js';
import { LessonsModule } from './lessons/lessons.module.js';
import { EnrollmentModule } from './enrollment/enrollment.module.js';
import { StorageModule } from './storage/storage.module.js';
import { VideoAssetModule } from './video-asset/video-asset.module.js';
import { BullModule } from '@nestjs/bullmq'
import { LessonProgressModule } from './lesson-progress/lesson-progress.module.js';
import { UsersModule } from './users/users.module.js';
import { AdminModule } from './admin/admin.module.js';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env']
    }),
    DbPoolModule,
    AuthModule.forRoot({ auth }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
    CoursesModule,
    LessonsModule,
    EnrollmentModule,
    StorageModule,
    VideoAssetModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: config.getOrThrow<number>('REDIS_PORT'),
        },
      }),
    }),
    LessonProgressModule,
    UsersModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule { }
