import { Controller, Get, Post, Body, Patch, Param, Res } from '@nestjs/common';
import { VideoAssetService } from './video-asset.service.js';
import { AllowAnonymous, Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { GetUploadVideoUrlDto } from './dto/create-video-asset.dto.js';
import type { Response } from 'express';

@Controller(['video-asset', 'videos', 'api/videos'])
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

  /**
   * Secure AES-128 Key Delivery Endpoint
   * Returns raw 16-byte binary decryption key under strict ZenStack authorization guards.
   */
  @Get(':lessonId/key')
  @AllowAnonymous()
  async getKey(
    @Param('lessonId') lessonId: string,
    @Session() session: UserSession | undefined,
    @Res() res: Response,
  ) {
    const keyBuffer = await this.videoAssetService.getVideoKey(lessonId, session?.user);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Content-Length', keyBuffer.length);
    return res.end(keyBuffer);
  }
}