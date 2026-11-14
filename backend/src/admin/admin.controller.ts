import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { Roles, Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { Throttle } from '@nestjs/throttler';
import { AdminService } from './admin.service.js';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto.js';
import { BanUserDto } from './dto/ban-user.dto.js';

@Roles(['admin'])
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * Platform dashboard metrics (total students, total instructors, total published courses, total enrollments, gross revenue)
   */
  @Get('stats')
  getStats(@Session() session: UserSession) {
    return this.adminService.getPlatformStats(session.user);
  }

  /**
   * Paginated user listing for platform admins with role and status filtering
   */
  @Get('users')
  listUsers(
    @Query() query: AdminUsersQueryDto,
    @Session() session: UserSession,
  ) {
    return this.adminService.listUsers(query, session.user);
  }

  /**
   * Moderation: Ban user and revoke active sessions (Admin only, Max 10 per min)
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Patch('users/:id/ban')
  banUser(
    @Param('id') id: string,
    @Body() dto: BanUserDto,
    @Session() session: UserSession,
  ) {
    return this.adminService.banUser(id, dto, session.user);
  }

  /**
   * Moderation: Unban user (Admin only, Max 10 per min)
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Patch('users/:id/unban')
  unbanUser(
    @Param('id') id: string,
    @Session() session: UserSession,
  ) {
    return this.adminService.unbanUser(id, session.user);
  }
}
