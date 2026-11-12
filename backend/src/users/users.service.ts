import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthUser, DbPoolService } from '../db-pool/db-pool.service.js';
import { StorageService } from '../storage/storage.service.js';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto.js';
import { GetAvatarUploadUrlDto } from './dto/avatar-upload.dto.js';
import { AssignInstructorDto } from './dto/assign-instructor.dto.js';
import crypto from 'node:crypto';

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DbPoolService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Returns current authenticated user profile with enrolled & authored course counts.
   */
  async getMe(user: AuthUser) {
    const profile = await this.db.forUser(user).user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        headline: true,
        bio: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            enrollments: true,
            coursesTaught: true,
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('User profile not found');
    }

    return profile;
  }

  /**
   * Updates user profile (name, headline, bio, avatar).
   * Automatically cleans up previous avatar from S3 if a new one is provided.
   */
  async updateMe(dto: UpdateUserProfileDto, user: AuthUser) {
    const userAvatarPrefix = `avatars/${user.id}/`;

    const updateData: {
      name?: string;
      headline?: string;
      bio?: string;
      image?: string | null;
    } = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.headline !== undefined && { headline: dto.headline }),
      ...(dto.bio !== undefined && { bio: dto.bio }),
    };

    let existingImage: string | null | undefined;

    if (dto.image !== undefined) {
      const existing = await this.db.forUser(user).user.findUnique({
        where: { id: user.id },
        select: { image: true },
      });
      existingImage = existing?.image;

      if (dto.image !== existingImage) {
        if (dto.image) {
          const newKey = this.storageService.getKeyFromUrl(dto.image);
          if (!newKey || !newKey.startsWith(userAvatarPrefix) || newKey.includes('..')) {
            throw new ForbiddenException(
              'Avatar image must be uploaded through the avatar upload endpoint',
            );
          }

          await this.storageService.verifyUploadedObject(newKey, 5 * 1024 * 1024, [
            'image/jpeg',
            'image/png',
            'image/webp',
          ]);
          updateData.image = this.storageService.getPublicUrl(newKey);
        } else {
          updateData.image = null;
        }
      }
    }

    const updated = await this.db.forUser(user).user.update({
      where: { id: user.id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        headline: true,
        bio: true,
        role: true,
        updatedAt: true,
      },
    });

    if (dto.image !== undefined && existingImage && existingImage !== updated.image) {
      const oldKey = this.storageService.getKeyFromUrl(existingImage);
      if (oldKey && oldKey.startsWith(userAvatarPrefix) && !oldKey.includes('..')) {
        await this.storageService.deleteFile(oldKey).catch(() => {});
      }
    }

    return updated;
  }

  /**
   * Generates a presigned PUT URL for direct avatar upload to Garage S3.
   * Maps validated image MIME types to safe extensions to prevent file spoofing.
   */
  async getAvatarUploadUrl(dto: GetAvatarUploadUrlDto, user: AuthUser) {
    const MIME_TO_EXT: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const cleanExt = MIME_TO_EXT[dto.contentType] || 'webp';
    const key = `avatars/${user.id}/${crypto.randomUUID()}.${cleanExt}`;

    const uploadUrl = await this.storageService.getUploadPresignedUrl(
      key,
      dto.contentType,
      900,
      dto.fileSize,
    );
    const publicUrl = this.storageService.getPublicUrl(key);

    return {
      uploadUrl,
      publicUrl,
      key,
    };
  }

  /**
   * Public instructor profile endpoint showing bio, avatar, and their published courses.
   * Keeps sensitive information (email, accounts, etc.) private.
   */
  async getInstructorProfile(instructorId: string) {
    const instructor = await this.db.forUser(null).user.findUnique({
      where: { id: instructorId },
      select: {
        id: true,
        name: true,
        image: true,
        headline: true,
        bio: true,
        role: true,
        banned: true,
        coursesTaught: {
          where: { published: true },
          select: {
            id: true,
            title: true,
            slug: true,
            thumbnail: true,
            price: true,
            _count: {
              select: {
                lessons: true,
                enrollments: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (
      !instructor ||
      instructor.banned ||
      (instructor.role !== 'instructor' && instructor.role !== 'admin')
    ) {
      throw new NotFoundException('Instructor not found');
    }

    const { banned, role, ...publicData } = instructor;
    return {
      ...publicData,
      role: 'instructor',
    };
  }

  /**
   * Admin-Only: Assigns the instructor role to any user by email.
   * Regular students cannot grant themselves the instructor role.
   */
  async assignInstructorByEmail(dto: AssignInstructorDto, adminUser: AuthUser) {
    // 1. Strict Authorization check: only admin can promote users
    const isAdmin = Array.isArray(adminUser.role)
      ? adminUser.role.includes('admin')
      : adminUser.role === 'admin';
    if (!isAdmin) {
      throw new ForbiddenException('Only platform administrators can assign instructor roles');
    }

    const normalizedEmail = dto.email.toLowerCase().trim();

    // 2. Find target user
    const targetUser = await this.db.forUser(adminUser).user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    if (!targetUser) {
      throw new NotFoundException(`User with email "${dto.email}" not found`);
    }

    if (targetUser.role === 'admin') {
      return {
        message: `User "${targetUser.email}" is an administrator and already has instructor privileges`,
        user: targetUser,
      };
    }

    if (targetUser.role === 'instructor') {
      return {
        message: `User "${targetUser.email}" is already an instructor`,
        user: targetUser,
      };
    }

    // 3. Promote user to instructor
    const updated = await this.db.forUser(adminUser).user.update({
      where: { id: targetUser.id },
      data: { role: 'instructor' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        updatedAt: true,
      },
    });

    return {
      message: `Successfully promoted ${updated.email} to instructor`,
      user: updated,
    };
  }
}
