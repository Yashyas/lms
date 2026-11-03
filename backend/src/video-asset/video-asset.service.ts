import { ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { UpdateVideoAssetDto } from './dto/update-video-asset.dto.js';
import { AuthUser, DbPoolService } from '../db-pool/db-pool.service.js';
import { GetUploadVideoUrlDto } from './dto/create-video-asset.dto.js';
import { VideoStatus } from '@lms/db';
import { StorageService } from '../storage/storage.service.js';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class VideoAssetService {
  constructor(
    private readonly db: DbPoolService,
    private readonly storageService: StorageService,
    @InjectQueue('video-transcode') private readonly videoTranscodeQueue: Queue,
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

    await this.videoTranscodeQueue.add('transcode-job', {
      videoAssetId: changedVideoAsset.id,
      lessonId: changedVideoAsset.lessonId,
      rawStorageKey: changedVideoAsset.rawStorageKey,
    })

    return changedVideoAsset;
  }

  /**
   * Secure AES-128 Key Delivery
   * Validates student enrollment or free-preview status via ZenStack policy before returning raw 16-byte key buffer.
   */
  async getVideoKey(lessonId: string, user?: AuthUser | null): Promise<Buffer> {
    // 1. Authorize access via ZenStack policy on Lesson
    const lesson = await this.db.forUser(user).lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, isFree: true, courseId: true },
    });

    if (!lesson) {
      throw new ForbiddenException('You are not authorized to access this video key');
    }

    // 2. Fetch the AES-128 encryption key from the internal VideoAsset record
    const videoAsset = await this.db.client.videoAsset.findUnique({
      where: { lessonId },
      select: { encryptionKey: true },
    });

    if (!videoAsset || !videoAsset.encryptionKey) {
      throw new NotFoundException('Decryption key not found for this lesson');
    }

    // 3. Convert 32-character hex key to raw 16-byte binary buffer
    const keyBuffer = Buffer.from(videoAsset.encryptionKey, 'hex');
    if (keyBuffer.length !== 16) {
      throw new InternalServerErrorException('Corrupted encryption key');
    }

    return keyBuffer;
  }

  remove(id: number) {
    return `This action removes a #${id} videoAsset`;
  }
}
