import { Controller, Get, Post, Body, Patch, Param } from '@nestjs/common';
import { VideoAssetService } from './video-asset.service.js';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { GetUploadVideoUrlDto } from './dto/create-video-asset.dto.js';

@Controller('video-asset')
export class VideoAssetController {
  constructor(private readonly videoAssetService: VideoAssetService) { }

  @Post('upload-url')
  getUploadUrl(@Body() getUploadVideoUrlDto: GetUploadVideoUrlDto, @Session() session: UserSession) {
    return this.videoAssetService.getUploadUrl(getUploadVideoUrlDto, session.user);
  }

  @Patch(':lessonId/upload-complete')
  markUpload(@Param('lessonId') lessonId: string, @Session() session: UserSession) {
    return this.videoAssetService.markupUploadComplete(lessonId, session.user);
  }
}