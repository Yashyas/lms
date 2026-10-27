import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from '@nestjs/config';
import { DbPoolModule } from './db-pool/db-pool.module.js';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './auth/auth.js';
import { CoursesModule } from './courses/courses.module.js';
import { LessonsModule } from './lessons/lessons.module.js';
import { EnrollmentModule } from './enrollment/enrollment.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env']
    }),
    DbPoolModule,
    AuthModule.forRoot({ auth }),
    CoursesModule,
    LessonsModule,
    EnrollmentModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
