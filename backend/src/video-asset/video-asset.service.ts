import { ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { UpdateVideoAssetDto } from './dto/update-video-asset.dto.js';
import { AuthUser, DbPoolService } from '../db-pool/db-pool.service.js';
import { GetUploadVideoUrlDto } from './dto/create-video-asset.dto.js';
import { VideoStatus } from '@lms/db';
import { StorageService } from '../storage/storage.service.js';

@Injectable()
export class VideoAssetService {
  constructor(
    private readonly db: DbPoolService,
    private readonly storageService: StorageService,
  ) { }

  async getUploadUrl(getUploadVideoUrlDto: GetUploadVideoUrlDto, user: AuthUser) {
    // check ownership of lesson
    const lesson = await this.db.forUser(user).lesson.findUnique({
      where: {
        id: getUploadVideoUrlDto.lessonId
      }
    })
    if (!lesson) {
      throw new NotFoundException("Lesson not found or you are not authorized for this Lesson")
    }
    // generate storage 
    const cleanFileName = getUploadVideoUrlDto.fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const rawStorageKey = `raw-videos/${lesson.courseId}/${lesson.id}/${crypto.randomUUID()}-${cleanFileName}`

    const videoAsset = await this.db.forUser(user).videoAsset.upsert({
      where: { lessonId: lesson.id },
      create: {
        lessonId: lesson.id,
        rawStorageKey: rawStorageKey,
        status: VideoStatus.PENDING_UPLOAD,
      },
      update: {
        rawStorageKey: rawStorageKey,
        status: VideoStatus.PENDING_UPLOAD,
        errorMessage: null,
      }
    })

    if (!videoAsset) {
      throw new InternalServerErrorException("Could not create Video Asset")
    }

    // get presigned url 
    const uploadUrl = await this.storageService.getUploadPresignedUrl(rawStorageKey, getUploadVideoUrlDto.contentType);

    return { uploadUrl, key: rawStorageKey, videoAsset: videoAsset.id };
  }


  // this function needs improvement will look into it in future 
  async markupUploadComplete(id: string, user: AuthUser) {
    const changedVideoAsset = await this.db.forUser(user).videoAsset.update({
      where: { lessonId: id },
      data: {
        status: VideoStatus.PROCESSING
      }
    })

    return changedVideoAsset;
  }

  remove(id: number) {
    return `This action removes a #${id} videoAsset`;
  }
}
