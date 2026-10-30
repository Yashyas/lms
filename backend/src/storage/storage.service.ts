import { BadRequestException, Injectable } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

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

    if (!accessKeyId || !secretAccessKey) {
      throw new BadRequestException('S3 Credentials missing from env')
    }

    this.s3Client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle,
    })
  }

  // functions here 
  async getUploadPresignedUrl(key: string, expiresIn = 900): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    })

    return await getSignedUrl(this.s3Client, command, { expiresIn, })
  }
}
