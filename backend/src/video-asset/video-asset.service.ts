import { Injectable } from '@nestjs/common';
import { CreateVideoAssetDto } from './dto/create-video-asset.dto.js';
import { UpdateVideoAssetDto } from './dto/update-video-asset.dto.js';

@Injectable()
export class VideoAssetService {
  create(createVideoAssetDto: CreateVideoAssetDto) {
    return 'This action adds a new videoAsset';
  }

  findAll() {
    return `This action returns all videoAsset`;
  }

  findOne(id: number) {
    return `This action returns a #${id} videoAsset`;
  }

  update(id: number, updateVideoAssetDto: UpdateVideoAssetDto) {
    return `This action updates a #${id} videoAsset`;
  }

  remove(id: number) {
    return `This action removes a #${id} videoAsset`;
  }
}
