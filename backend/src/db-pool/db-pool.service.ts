// backend/src/db-pool/database.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PostgresDialect, schema, ZenStackClient } from '@lms/db';

try { process.loadEnvFile('.env'); } catch { }
try { process.loadEnvFile('../.env'); } catch { }

export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
});

export const rawDbClient = new ZenStackClient(schema, {
  dialect: new PostgresDialect({ pool: pgPool }),
});

@Injectable()
export class DbPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbPoolService.name);
  public readonly pool = pgPool;
  public readonly client = rawDbClient;

  async onModuleInit() {

    this.pool.on('error', (err) => {
      this.logger.error('Unexpected error on idle pg client', err);
    });

    try {
      await this.client.$connect();
      this.logger.log('Connected to PostgreSQL via ZenStack Client');
    } catch (err) {
      this.logger.error('Failed to connect to database', err);
      throw err;
    }
  }

  // Model accessors
  get user() {
    return this.client.user;
  }

  get post() {
    return this.client.post;
  }

  async onModuleDestroy() {
    await this.client?.$disconnect();
    await this.pool?.end();
  }
}
