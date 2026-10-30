import { PartialType } from '@nestjs/swagger';
import { CreateVideoAssetDto } from './create-video-asset.dto.js';

export class UpdateVideoAssetDto extends PartialType(CreateVideoAssetDto) {}
