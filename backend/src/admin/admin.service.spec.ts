import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminService } from './admin.service.js';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

describe('AdminService', () => {
  let service: AdminService;
  let mockDb: any;
  let mockUserClient: any;
  let mockSessionClient: any;
  let mockCourseClient: any;
  let mockEnrollmentClient: any;
  let mockPool: any;

  const adminUser = { id: 'admin_1', role: 'admin' };

  beforeEach(() => {
    vi.clearAllMocks();

    mockUserClient = {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    };

    mockSessionClient = {
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    };

    mockCourseClient = {
      count: vi.fn(),
    };

    mockEnrollmentClient = {
      count: vi.fn(),
    };

    mockPool = {
      query: vi.fn(),
    };

    mockDb = {
      forUser: vi.fn().mockImplementation(() => ({
        user: mockUserClient,
        session: mockSessionClient,
        course: mockCourseClient,
        enrollment: mockEnrollmentClient,
      })),
      pool: mockPool,
    };

    service = new AdminService(mockDb as any);
  });

  describe('getPlatformStats', () => {
    it('returns aggregated platform statistics and gross revenue', async () => {
      mockUserClient.count
        .mockResolvedValueOnce(150) // students
        .mockResolvedValueOnce(12); // instructors
      mockCourseClient.count.mockResolvedValueOnce(25); // courses
      mockEnrollmentClient.count.mockResolvedValueOnce(340); // enrollments
      mockPool.query.mockResolvedValueOnce({
        rows: [{ grossRevenue: '2500000' }], // 25,000 INR stored as 2,500,000 paise
      });

      const stats = await service.getPlatformStats(adminUser as any);

      expect(stats).toEqual({
        totalStudents: 150,
        totalInstructors: 12,
        totalPublishedCourses: 25,
        totalEnrollments: 340,
        grossRevenue: 2500000,
        grossRevenuePaise: 2500000,
        grossRevenueRupees: 25000,
      });

      expect(mockDb.forUser).toHaveBeenCalledWith(adminUser);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('handles zero revenue safely when there are no enrollments', async () => {
      mockUserClient.count.mockResolvedValue(0);
      mockCourseClient.count.mockResolvedValue(0);
      mockEnrollmentClient.count.mockResolvedValue(0);
      mockPool.query.mockResolvedValueOnce({ rows: [{ grossRevenue: '0' }] });

      const stats = await service.getPlatformStats(adminUser as any);

      expect(stats.grossRevenue).toBe(0);
      expect(stats.grossRevenueRupees).toBe(0);
    });
  });

  describe('listUsers', () => {
    it('returns paginated users with defaults', async () => {
      const mockUsers = [
        { id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'student', banned: false },
        { id: 'u2', name: 'Bob', email: 'bob@example.com', role: 'instructor', banned: false },
      ];
      mockUserClient.findMany.mockResolvedValueOnce(mockUsers);
      mockUserClient.count.mockResolvedValueOnce(2);

      const result = await service.listUsers({}, adminUser as any);

      expect(result.items).toEqual(mockUsers);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
      expect(mockUserClient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        }),
      );
    });

    it('applies role, active status and search filter properly', async () => {
      mockUserClient.findMany.mockResolvedValueOnce([]);
      mockUserClient.count.mockResolvedValueOnce(0);

      await service.listUsers(
        { page: 2, limit: 10, role: 'student', status: 'active', search: 'alice' },
        adminUser as any,
      );

      expect(mockUserClient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
          where: {
            AND: [
              { role: 'student' },
              { OR: [{ banned: false }, { banned: null }] },
              {
                OR: [
                  { name: { contains: 'alice', mode: 'insensitive' } },
                  { email: { contains: 'alice', mode: 'insensitive' } },
                ],
              },
            ],
          },
        }),
      );
    });

    it('applies banned status filter properly', async () => {
      mockUserClient.findMany.mockResolvedValueOnce([]);
      mockUserClient.count.mockResolvedValueOnce(0);

      await service.listUsers({ status: 'banned' }, adminUser as any);

      expect(mockUserClient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [{ banned: true }],
          },
        }),
      );
    });
  });

  describe('banUser', () => {
    it('rejects banning own account with BadRequestException', async () => {
      await expect(
        service.banUser('admin_1', { banReason: 'self' }, adminUser as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockUserClient.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.banUser('non_existent', {}, adminUser as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('forbids banning another administrator account', async () => {
      mockUserClient.findUnique.mockResolvedValueOnce({
        id: 'admin_2',
        email: 'admin2@example.com',
        role: 'admin',
      });

      await expect(
        service.banUser('admin_2', {}, adminUser as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('successfully bans student, records reason/expires, and revokes sessions', async () => {
      mockUserClient.findUnique.mockResolvedValueOnce({
        id: 'user_456',
        email: 'student@example.com',
        role: 'student',
      });

      const mockBannedUser = {
        id: 'user_456',
        email: 'student@example.com',
        role: 'student',
        banned: true,
        banReason: 'Spamming',
        banExpires: new Date(Date.now() + 3600000),
      };
      mockUserClient.update.mockResolvedValueOnce(mockBannedUser);

      const res = await service.banUser(
        'user_456',
        { banReason: 'Spamming', banExpiresIn: 3600 },
        adminUser as any,
      );

      expect(res.message).toContain('student@example.com');
      expect(res.user).toEqual(mockBannedUser);
      expect(mockUserClient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user_456' },
          data: expect.objectContaining({
            banned: true,
            banReason: 'Spamming',
          }),
        }),
      );
      expect(mockSessionClient.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user_456' },
      });
    });
  });

  describe('unbanUser', () => {
    it('throws NotFoundException when target user not found', async () => {
      mockUserClient.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.unbanUser('non_existent', adminUser as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when user is not currently banned', async () => {
      mockUserClient.findUnique.mockResolvedValueOnce({
        id: 'user_789',
        email: 'active@example.com',
        banned: false,
      });

      await expect(
        service.unbanUser('user_789', adminUser as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('successfully unbans user and clears ban metadata', async () => {
      mockUserClient.findUnique.mockResolvedValueOnce({
        id: 'user_789',
        email: 'banned@example.com',
        banned: true,
      });

      const mockUnbannedUser = {
        id: 'user_789',
        email: 'banned@example.com',
        role: 'student',
        banned: false,
        banReason: null,
        banExpires: null,
      };
      mockUserClient.update.mockResolvedValueOnce(mockUnbannedUser);

      const res = await service.unbanUser('user_789', adminUser as any);

      expect(res.message).toContain('banned@example.com');
      expect(res.user).toEqual(mockUnbannedUser);
      expect(mockUserClient.update).toHaveBeenCalledWith({
        where: { id: 'user_789' },
        data: {
          banned: false,
          banReason: null,
          banExpires: null,
        },
        select: expect.any(Object),
      });
    });
  });
});
