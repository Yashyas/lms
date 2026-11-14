import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthUser, DbPoolService } from '../db-pool/db-pool.service.js';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto.js';
import { BanUserDto } from './dto/ban-user.dto.js';

@Injectable()
export class AdminService {
  constructor(private readonly db: DbPoolService) {}

  /**
   * 1. GET /admin/stats
   * Aggregates platform-wide counts and gross revenue concurrently.
   */
  async getPlatformStats(adminUser: AuthUser) {
    const [
      totalStudents,
      totalInstructors,
      totalPublishedCourses,
      totalEnrollments,
      revenueResult,
    ] = await Promise.all([
      this.db.forUser(adminUser).user.count({
        where: { OR: [{ role: 'student' }, { role: null }] },
      }),
      this.db.forUser(adminUser).user.count({
        where: { role: 'instructor' },
      }),
      this.db.forUser(adminUser).course.count({
        where: { published: true },
      }),
      this.db.forUser(adminUser).enrollment.count(),
      this.db.pool.query<{ grossRevenue: string }>(`
        SELECT COALESCE(SUM(c.price), 0)::bigint AS "grossRevenue"
        FROM enrollment e
        JOIN course c ON e."courseId" = c.id
      `),
    ]);

    const grossRevenuePaise = Number(revenueResult.rows[0]?.grossRevenue ?? 0);

    return {
      totalStudents,
      totalInstructors,
      totalPublishedCourses,
      totalEnrollments,
      grossRevenue: grossRevenuePaise,
      grossRevenuePaise,
      grossRevenueRupees: Math.floor(grossRevenuePaise / 100),
    };
  }

  /**
   * 2. GET /admin/users
   * Paginated user list with role, status, and search filters.
   */
  async listUsers(query: AdminUsersQueryDto, adminUser: AuthUser) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const trimmedSearch = query.search?.trim();

    const conditions: any[] = [];

    if (query.role) {
      conditions.push({ role: query.role });
    }

    if (query.status === 'banned') {
      conditions.push({ banned: true });
    } else if (query.status === 'active') {
      conditions.push({
        OR: [{ banned: false }, { banned: null }],
      });
    }

    if (trimmedSearch) {
      conditions.push({
        OR: [
          { name: { contains: trimmedSearch, mode: 'insensitive' } },
          { email: { contains: trimmedSearch, mode: 'insensitive' } },
        ],
      });
    }

    const where = conditions.length > 0 ? { AND: conditions } : {};

    const [items, total] = await Promise.all([
      this.db.forUser(adminUser).user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          image: true,
          role: true,
          banned: true,
          banReason: true,
          banExpires: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.db.forUser(adminUser).user.count({ where }),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * 3. PATCH /admin/users/:id/ban
   * Moderation endpoint: sets banned flag, records reason/expiry, and revokes active sessions.
   */
  async banUser(userId: string, dto: BanUserDto, adminUser: AuthUser) {
    if (userId === adminUser.id) {
      throw new BadRequestException('You cannot ban your own account');
    }

    const targetUser = await this.db.forUser(adminUser).user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!targetUser) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }

    if (targetUser.role === 'admin') {
      throw new ForbiddenException('Cannot ban an administrator account');
    }

    const banExpires = dto?.banExpiresIn
      ? new Date(Date.now() + dto.banExpiresIn * 1000)
      : null;

    const [updatedUser] = await Promise.all([
      this.db.forUser(adminUser).user.update({
        where: { id: userId },
        data: {
          banned: true,
          banReason: dto?.banReason || 'Banned by administrator',
          banExpires,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          banned: true,
          banReason: true,
          banExpires: true,
          updatedAt: true,
        },
      }),
      this.db.forUser(adminUser).session.deleteMany({
        where: { userId },
      }),
    ]);

    return {
      message: `User "${targetUser.email}" has been banned and active sessions revoked`,
      user: updatedUser,
    };
  }

  /**
   * 4. PATCH /admin/users/:id/unban
   * Moderation endpoint: clears ban status, reason, and expiry.
   */
  async unbanUser(userId: string, adminUser: AuthUser) {
    const targetUser = await this.db.forUser(adminUser).user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, banned: true },
    });

    if (!targetUser) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }

    if (!targetUser.banned) {
      throw new BadRequestException(
        `User "${targetUser.email}" is not currently banned`,
      );
    }

    const updatedUser = await this.db.forUser(adminUser).user.update({
      where: { id: userId },
      data: {
        banned: false,
        banReason: null,
        banExpires: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        banned: true,
        banReason: true,
        banExpires: true,
        updatedAt: true,
      },
    });

    return {
      message: `User "${targetUser.email}" has been unbanned successfully`,
      user: updatedUser,
    };
  }
}
