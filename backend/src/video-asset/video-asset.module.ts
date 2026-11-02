import { Module } from '@nestjs/common';
import { VideoAssetService } from './video-asset.service.js';
import { VideoAssetController } from './video-asset.controller.js';
import { StorageModule } from '../storage/storage.module.js';
import { BullModule } from '@nestjs/bullmq';
import { VideoTranscodeProcessor } from './video-transcode.processor.js';

@Module({
  imports: [
    StorageModule,
    BullModule.registerQueue({
      name: 'video-transcode',
    })],
  controllers: [VideoAssetController],
  providers: [VideoAssetService, VideoTranscodeProcessor],
})
export class VideoAssetModule { }
