import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsersService } from './users.service.js';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('UsersService Security Fixes', () => {
  let service: UsersService;
  let mockDb: any;
  let mockStorageService: any;
  let mockUserClient: any;

  const testUser = { id: 'user_123', role: 'student' };

  beforeEach(() => {
    mockUserClient = {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };

    mockDb = {
      forUser: vi.fn().mockReturnValue(mockUserClient),
    };

    mockStorageService = {
      getKeyFromUrl: vi.fn((url: string) => {
        if (!url || !url.includes('lms-media')) return null;
        const parts = url.split('lms-media/');
        return parts.length > 1 ? parts[1].split('?')[0] : null;
      }),
      getPublicUrl: vi.fn((key: string) => `http://s3.local/lms-media/${key}`),
      verifyUploadedObject: vi.fn().mockResolvedValue({ size: 1024, contentType: 'image/png' }),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    };

    service = new UsersService(mockDb as any, mockStorageService as any);
  });

  describe('updateMe Avatar Security', () => {
    it('rejects avatar with path traversal sequence', async () => {
      mockUserClient.user.findUnique.mockResolvedValue({ image: null });

      const maliciousUrl = 'http://s3.local/lms-media/avatars/user_123/../../thumbnails/evil.png';
      await expect(
        service.updateMe({ image: maliciousUrl }, testUser as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects avatar targeting another user directory', async () => {
      mockUserClient.user.findUnique.mockResolvedValue({ image: null });

      const otherUserUrl = 'http://s3.local/lms-media/avatars/other_user/avatar.png';
      await expect(
        service.updateMe({ image: otherUserUrl }, testUser as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('converts client-supplied URL into canonical S3 public URL preventing host injection', async () => {
      mockUserClient.user.findUnique.mockResolvedValue({ image: null });
      mockUserClient.user.update.mockImplementation(({ data }: any) => Promise.resolve({ id: testUser.id, ...data }));

      const clientUrl = 'http://evil-tracker.com/lms-media/avatars/user_123/pic.png';
      const result = await service.updateMe({ image: clientUrl }, testUser as any);

      expect(mockStorageService.verifyUploadedObject).toHaveBeenCalledWith(
        'avatars/user_123/pic.png',
        5 * 1024 * 1024,
        ['image/jpeg', 'image/png', 'image/webp'],
      );
      // Canonical URL from storage service is used instead of evil-tracker.com
      expect(result.image).toBe('http://s3.local/lms-media/avatars/user_123/pic.png');
    });

    it('preserves existing external OAuth avatar without throwing error', async () => {
      const oauthAvatar = 'https://lh3.googleusercontent.com/a/photo.jpg';
      mockUserClient.user.findUnique.mockResolvedValue({ image: oauthAvatar });
      mockUserClient.user.update.mockResolvedValue({ id: testUser.id, name: 'New Name', image: oauthAvatar });

      const result = await service.updateMe({ name: 'New Name', image: oauthAvatar }, testUser as any);
      expect(result.name).toBe('New Name');
      expect(mockStorageService.verifyUploadedObject).not.toHaveBeenCalled();
    });

    it('deletes old avatar from S3 only after DB update completes', async () => {
      const oldAvatar = 'http://s3.local/lms-media/avatars/user_123/old.png';
      mockUserClient.user.findUnique.mockResolvedValue({ image: oldAvatar });
      mockUserClient.user.update.mockResolvedValue({
        id: testUser.id,
        image: 'http://s3.local/lms-media/avatars/user_123/new.png',
      });

      const newUrl = 'http://s3.local/lms-media/avatars/user_123/new.png';
      await service.updateMe({ image: newUrl }, testUser as any);

      expect(mockStorageService.deleteFile).toHaveBeenCalledWith('avatars/user_123/old.png');
    });

    it('skips existing image query on text-only updates', async () => {
      mockUserClient.user.update.mockResolvedValue({ id: testUser.id, name: 'Only Name' });

      const result = await service.updateMe({ name: 'Only Name' }, testUser as any);
      expect(result.name).toBe('Only Name');
      expect(mockUserClient.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getMe', () => {
    it('returns user profile with counts', async () => {
      const mockProfile = {
        id: testUser.id,
        name: 'Test User',
        email: 'test@example.com',
        _count: { enrollments: 2, coursesTaught: 1 },
      };
      mockUserClient.user.findUnique.mockResolvedValue(mockProfile);

      const res = await service.getMe(testUser as any);
      expect(res).toEqual(mockProfile);
      expect(mockUserClient.user.findUnique).toHaveBeenCalledWith({
        where: { id: testUser.id },
        select: expect.any(Object),
      });
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockUserClient.user.findUnique.mockResolvedValue(null);

      await expect(service.getMe(testUser as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getInstructorProfile Admin Role Masking', () => {
    it('normalizes admin role to instructor', async () => {
      mockUserClient.user.findUnique.mockResolvedValue({
        id: 'admin_1',
        name: 'Admin Instructor',
        role: 'admin',
        banned: false,
        coursesTaught: [],
      });

      const profile = await service.getInstructorProfile('admin_1');
      expect(profile.role).toBe('instructor');
    });
  });

  describe('assignInstructorByEmail Role Authorization', () => {
    it('allows admin with array role to assign instructor', async () => {
      const adminUser = { id: 'admin_1', role: ['admin'] };
      mockUserClient.user.findUnique.mockResolvedValue({
        id: 'student_1',
        email: 'student@example.com',
        role: 'student',
      });
      mockUserClient.user.update.mockResolvedValue({
        id: 'student_1',
        email: 'student@example.com',
        role: 'instructor',
      });

      const res = await service.assignInstructorByEmail({ email: 'student@example.com' }, adminUser as any);
      expect(res.user.role).toBe('instructor');
    });

    it('forbids non-admin users from assigning instructor', async () => {
      const regularUser = { id: 'user_1', role: 'student' };
      await expect(
        service.assignInstructorByEmail({ email: 'test@example.com' }, regularUser as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});

