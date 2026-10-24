// backend/src/db-pool/database.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PolicyPlugin, PostgresDialect, schema, ZenStackClient } from '@lms/db';

try { process.loadEnvFile('.env'); } catch { }
try { process.loadEnvFile('../.env'); } catch { }

export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
});

export const rawDbClient = new ZenStackClient(schema, {
  dialect: new PostgresDialect({ pool: pgPool }),
});

export type AuthUser = { id: string; role?: string | null };

@Injectable()
export class DbPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbPoolService.name);
  public readonly pool = pgPool;
  public readonly client = rawDbClient;
  private readonly protectedClient = this.client.$use(new PolicyPlugin())


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

  forUser(user?: AuthUser | null) {
    return this.protectedClient.$setAuth(user ?? undefined)
  }

  // Model accessors
  get user() {
    return this.client.user;
  }

  get course() {
    return this.client.course;
  }

  get lesson() {
    return this.client.lesson;
  }

  get enrollment() {
    return this.client.enrollment;
  }

  async onModuleDestroy() {
    await this.client?.$disconnect();
    await this.pool?.end();
  }
}
