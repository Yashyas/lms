import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { VideoAssetService } from './video-asset.service.js';
import { CreateVideoAssetDto } from './dto/create-video-asset.dto.js';
import { UpdateVideoAssetDto } from './dto/update-video-asset.dto.js';

@Controller('video-asset')
export class VideoAssetController {
  constructor(private readonly videoAssetService: VideoAssetService) {}

  @Post()
  create(@Body() createVideoAssetDto: CreateVideoAssetDto) {
    return this.videoAssetService.create(createVideoAssetDto);
  }

  @Get()
  findAll() {
    return this.videoAssetService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.videoAssetService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateVideoAssetDto: UpdateVideoAssetDto) {
    return this.videoAssetService.update(+id, updateVideoAssetDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.videoAssetService.remove(+id);
  }
}
