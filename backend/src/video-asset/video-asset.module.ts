import { Module } from '@nestjs/common';
import { VideoAssetService } from './video-asset.service.js';
import { VideoAssetController } from './video-asset.controller.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [StorageModule],
  controllers: [VideoAssetController],
  providers: [VideoAssetService],
})
export class VideoAssetModule { }
