import { Injectable } from '@nestjs/common';
import { DbPoolService } from './db-pool/db-pool.service.js';

@Injectable()
export class AppService {
  constructor(private readonly db: DbPoolService) { }
  async getHello() {
    const userCount = await this.db.user.count()
    return { message: `ZenStack is connected to the backend, UserCount: ${userCount}` };
  }
}
