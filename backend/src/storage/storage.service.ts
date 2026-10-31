import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, PutObjectCommandInput, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Readable } from 'node:stream';

@Injectable()
export class StorageService {

  private readonly s3Client: S3Client
  private readonly bucketName: string
  constructor() {
    // connect to s3 client 
    const region = process.env.S3_REGION
    const endpoint = process.env.S3_ENDPOINT
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true'
    const accessKeyId = process.env.S3_ACCESS_KEY
    const secretAccessKey = process.env.S3_SECRET_KEY

    this.bucketName = process.env.S3_BUCKET || ''

    if (!accessKeyId || !secretAccessKey || !this.bucketName) {
      throw new InternalServerErrorException('S3 Credentials or BucketName missing from env')
    }

    this.s3Client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  }

  // functions here 
  async getUploadPresignedUrl(key: string, contentType: string, expiresIn = 900): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    })

    return await getSignedUrl(this.s3Client, command, { expiresIn })
  }

  // download raw video stream 
  async getRawVideo(key: string): Promise<Readable> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    })
    const res = await this.s3Client.send(command)
    return res.Body as Readable
  }

  // upload chunks of video 
  async uploadChunk(key: string, body: PutObjectCommandInput["Body"], contentType: string, eTag?: string) {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    })

    const res = await this.s3Client.send(command)
    return res
  }

  // delete raw video file after chunking 
  async deleteRawVideo(key: string) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    })
    const res = await this.s3Client.send(command)
    return res
  }

  // delete uploaded chunks and everything of a video 
  // this can only be used for video deletion make prefix check very strict and backend only so no error can happen 
  async deleteVideoChunks(prefix: string) {
    // give prefix like 'hls/lessonId/
    if (!prefix || prefix.trim().length < 5 || prefix.includes('..')) {
      throw new InternalServerErrorException('Invalid or dangerous S3 deletion prefix');
    }
    // find all objects with this prefix and delete them 

    let continuationToken: string | undefined = undefined;
    do {
      const listCommand: ListObjectsV2Command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })

      const listRes = await this.s3Client.send(listCommand)
      if (!listRes.Contents || listRes.Contents.length == 0) return

      // multiple delete command 
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: this.bucketName,
        Delete: {
          Objects: listRes.Contents.map((item) => ({
            Key: item.Key!,
          })),
        },
      })
      await this.s3Client.send(deleteCommand)
      continuationToken = listRes.NextContinuationToken
    }
    while (continuationToken)
  }
}
