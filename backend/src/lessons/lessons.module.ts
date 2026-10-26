import { Module } from '@nestjs/common';
import { LessonsService } from './lessons.service.js';
import { LessonsController } from './lessons.controller.js';

@Module({
  controllers: [LessonsController],
  providers: [LessonsService],
})
export class LessonsModule {}
