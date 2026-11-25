import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { NotificationService } from './notification.service.js';
import { CreateNotificationDto } from './dto/create-notification.dto.js';
import { UpdateNotificationDto } from './dto/update-notification.dto.js';

@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) { }

  @Get('recent')
  findAll() {
    return this.notificationService.findAll();
  }

  @Get('stream')
  findOne(@Param('id') id: string) {
    return this.notificationService.findOne(+id);
  }

}
