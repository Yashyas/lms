import { Processor, WorkerHost } from "@nestjs/bullmq";
import { DbPoolService } from "../db-pool/db-pool.service.js";
import { StorageService } from "../storage/storage.service.js";
import { Job } from "bullmq";
import { pipeline } from "node:stream/promises";
import fs, { createWriteStream } from "node:fs";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { exec } from "node:child_process";
import { VideoStatus } from "@lms/db";

interface Rendition {
    name: string;
    width: number;
    height: number;
    profile: string;
    level: string;
    crf: number;
    maxRate: string;
    bufSize: string;
    audioBitrate: string;
}

const ALL_RENDITIONS: Rendition[] = [
    { name: '1080p', width: 1920, height: 1080, profile: 'high', level: '4.1', crf: 22, maxRate: '3000k', bufSize: '6000k', audioBitrate: '128k' },
    { name: '720p', width: 1280, height: 720, profile: 'high', level: '3.1', crf: 23, maxRate: '1500k', bufSize: '3000k', audioBitrate: '128k' },
    { name: '480p', width: 854, height: 480, profile: 'main', level: '3.1', crf: 23, maxRate: '800k', bufSize: '1600k', audioBitrate: '96k' },
    { name: '360p', width: 640, height: 360, profile: 'main', level: '3.0', crf: 24, maxRate: '400k', bufSize: '800k', audioBitrate: '64k' },
];

@Processor('video-transcode')
export class VideoTranscodeProcessor extends WorkerHost {
    constructor(
        private readonly db: DbPoolService,
        private readonly storageService: StorageService,
    ) { super(); }

    // probe video details using ffprobe
    private async probeVideo(inputPath: string): Promise<{ width: number; height: number; durationSeconds: number; hasAudio: boolean }> {
        const execAsync = promisify(exec);
        const cmd = `ffprobe -v error -show_entries stream=codec_type,width,height -show_entries format=duration -of json "${inputPath}"`;

        const { stdout } = await execAsync(cmd);
        const info = JSON.parse(stdout);

        const videoStream = info.streams?.find((s: any) => s.codec_type === 'video');
        const hasAudio = info.streams?.some((s: any) => s.codec_type === 'audio') ?? false;
        const width = videoStream?.width || 0;
        const height = videoStream?.height || 0;

        // Duration can be located in format or stream depending on container
        const rawDuration = parseFloat(info.format?.duration || '0');
        const durationSeconds = Math.round(rawDuration);

        if (!width || !height) {
            throw new Error(`Failed to probe video dimensions for: ${inputPath}`);
        }

        return { width, height, durationSeconds, hasAudio };
    }

    // video processing job 
    async process(job: Job<{ videoAssetId: string; lessonId: string; rawStorageKey: string }>) {
        const { videoAssetId, lessonId, rawStorageKey } = job.data;
        const workDir = `/tmp/transcode/${job.id}`;
        const outputDir = `${workDir}/output`;
        try {
            await fs.promises.mkdir(outputDir, { recursive: true });

            // download raw video from s3 
            const inputPath = `${workDir}/input.mp4`;
            const readStream = await this.storageService.getRawVideo(rawStorageKey);
            await pipeline(readStream, createWriteStream(inputPath));

            // probe the video details 
            const { width, height, durationSeconds, hasAudio } = await this.probeVideo(inputPath);

            // generate aes-128 cryptographic key 
            const key = crypto.randomBytes(16);
            const iv = crypto.randomBytes(16);
            const keyPath = `${workDir}/secret.key`;
            await fs.promises.writeFile(keyPath, key);

            const keyUrl = `/api/videos/${lessonId}/key`;
            const keyInfo = `${keyUrl}\n${keyPath}\n${iv.toString('hex')}\n`;
            await fs.promises.writeFile(`${workDir}/enc.keyinfo`, keyInfo);

            // 1. Select renditions (never upscale, at least lowest profile)
            let renditions = ALL_RENDITIONS.filter(r => r.height <= height);
            if (renditions.length === 0) {
                renditions = [ALL_RENDITIONS[ALL_RENDITIONS.length - 1]];
            }

            // 2. Build dynamic filter_complex (split + scale preserving even dimensions)
            const splitOutputs = renditions.map((_, i) => `[v${i}]`).join('');
            const filterComplexParts = [`[0:v]split=${renditions.length}${splitOutputs}`];

            renditions.forEach((r, i) => {
                filterComplexParts.push(
                    `[v${i}]scale=w=${r.width}:h=${r.height}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2[v${i}out]`
                );
            });
            const filterComplex = filterComplexParts.join('; ');

            // 3. Build stream maps with libx264, Capped CRF, VBV limits, and strict GOP alignment
            const mapArgs: string[] = [];
            renditions.forEach((r, i) => {
                mapArgs.push(
                    `-map`, `"[v${i}out]"`,
                    `-c:v:${i}`, `libx264`,
                    `-preset`, `veryfast`,
                    `-profile:v:${i}`, r.profile,
                    `-level:v:${i}`, r.level,
                    `-crf:${i}`, `${r.crf}`,
                    `-maxrate:v:${i}`, r.maxRate,
                    `-bufsize:v:${i}`, r.bufSize,
                    `-g`, `60`,
                    `-keyint_min`, `60`,
                    `-sc_threshold`, `0`
                );
                if (hasAudio) {
                    mapArgs.push(`-map`, `0:a`, `-c:a:${i}`, `aac`, `-b:a:${i}`, r.audioBitrate);
                }
            });

            // 4. Build var_stream_map (links video and audio streams to rendition name)
            const varStreamMap = renditions
                .map((r, i) => hasAudio ? `v:${i},a:${i},name:${r.name}` : `v:${i},name:${r.name}`)
                .join(' ');

            // 5. Execute FFmpeg
            const execAsync = promisify(exec);
            const ffmpegCmd = [
                'nice -n 10 ffmpeg -y',
                '-threads 3',
                `-i "${inputPath}"`,
                `-filter_complex "${filterComplex}"`,
                ...mapArgs,
                '-f hls',
                '-hls_time 6',
                '-hls_playlist_type vod',
                '-hls_flags independent_segments',
                `-hls_key_info_file "${workDir}/enc.keyinfo"`,
                `-hls_segment_filename "${outputDir}/%v_segment%03d.ts"`,
                `-master_pl_name master.m3u8`,
                `-var_stream_map "${varStreamMap}"`,
                `"${outputDir}/%v.m3u8"`
            ].join(' ');

            await execAsync(ffmpegCmd);

            // upload chunked file to s3 storage
            const files = await fs.promises.readdir(outputDir);

            for (const file of files) {
                const filePath = `${outputDir}/${file}`;
                const fileBuffer = await fs.promises.readFile(filePath);
                const contentType = file.endsWith('.m3u8')
                    ? 'application/x-mpegURL'
                    : 'video/mp2t';

                await this.storageService.uploadChunk(
                    `hls/${lessonId}/${file}`,
                    fileBuffer,
                    contentType
                );
            }

            // update db record 
            await this.db.client.videoAsset.update({
                where: {
                    id: videoAssetId
                },
                data: {
                    status: VideoStatus.READY,
                    hlsMasterUrl: `hls/${lessonId}/master.m3u8`,
                    encryptionIv: iv.toString('hex'),
                    encryptionKey: key.toString('hex'),
                    rawStorageKey: null,
                    durationSeconds,
                }
            });

            // delete the tmp folder and raw video 
            await fs.promises.rm(workDir, { recursive: true, force: true });
            await this.storageService.deleteRawVideo(rawStorageKey);
        } catch (error: any) {
            // catch error to mark it failed , delete tmp file 
            await this.db.client.videoAsset.update({
                where: {
                    id: videoAssetId
                },
                data: {
                    status: VideoStatus.FAILED,
                    errorMessage: error.message?.slice(0, 255) || 'Transcoding failed',
                }
            });
            await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => { });
            throw error;
        }
    }
}
