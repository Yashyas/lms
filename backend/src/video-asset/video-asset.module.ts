import { Module } from '@nestjs/common';
import { VideoAssetService } from './video-asset.service.js';
import { VideoAssetController } from './video-asset.controller.js';

@Module({
  controllers: [VideoAssetController],
  providers: [VideoAssetService],
})
export class VideoAssetModule {}
