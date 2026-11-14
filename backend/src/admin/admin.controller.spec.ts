import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

describe('AdminController', () => {
  let controller: AdminController;
  let mockAdminService: any;

  const mockSession = {
    user: { id: 'admin_1', email: 'admin@example.com', role: 'admin' },
    session: { id: 'sess_1', userId: 'admin_1' },
  };

  beforeEach(() => {
    mockAdminService = {
      getPlatformStats: vi.fn(),
      listUsers: vi.fn(),
      banUser: vi.fn(),
      unbanUser: vi.fn(),
    };

    controller = new AdminController(mockAdminService as unknown as AdminService);
  });

  describe('getStats', () => {
    it('delegates to adminService.getPlatformStats with session user', async () => {
      const stats = {
        totalStudents: 100,
        totalInstructors: 10,
        totalPublishedCourses: 5,
        totalEnrollments: 200,
        grossRevenue: 500000,
        grossRevenuePaise: 500000,
        grossRevenueRupees: 5000,
      };
      mockAdminService.getPlatformStats.mockResolvedValueOnce(stats);

      const res = await controller.getStats(mockSession as any);

      expect(res).toBe(stats);
      expect(mockAdminService.getPlatformStats).toHaveBeenCalledWith(mockSession.user);
    });
  });

  describe('listUsers', () => {
    it('delegates to adminService.listUsers with query and session user', async () => {
      const query = { page: 1, limit: 10, role: 'student' };
      const expectedResult = { items: [], meta: { page: 1, limit: 10, total: 0, totalPages: 1 } };
      mockAdminService.listUsers.mockResolvedValueOnce(expectedResult);

      const res = await controller.listUsers(query, mockSession as any);

      expect(res).toBe(expectedResult);
      expect(mockAdminService.listUsers).toHaveBeenCalledWith(query, mockSession.user);
    });
  });

  describe('banUser', () => {
    it('delegates to adminService.banUser with target id, dto, and session user', async () => {
      const dto = { banReason: 'Spamming', banExpiresIn: 3600 };
      const expectedResult = { message: 'User banned' };
      mockAdminService.banUser.mockResolvedValueOnce(expectedResult);

      const res = await controller.banUser('target_user', dto, mockSession as any);

      expect(res).toBe(expectedResult);
      expect(mockAdminService.banUser).toHaveBeenCalledWith(
        'target_user',
        dto,
        mockSession.user,
      );
    });
  });

  describe('unbanUser', () => {
    it('delegates to adminService.unbanUser with target id and session user', async () => {
      const expectedResult = { message: 'User unbanned' };
      mockAdminService.unbanUser.mockResolvedValueOnce(expectedResult);

      const res = await controller.unbanUser('target_user', mockSession as any);

      expect(res).toBe(expectedResult);
      expect(mockAdminService.unbanUser).toHaveBeenCalledWith(
        'target_user',
        mockSession.user,
      );
    });
  });
});
