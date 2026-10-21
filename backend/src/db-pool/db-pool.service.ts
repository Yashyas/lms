// backend/src/db-pool/database.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PostgresDialect, schema, ZenStackClient } from '@lms/db';

@Injectable()
export class DbPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbPoolService.name);
  public pool!: Pool;
  public client!: InstanceType<typeof ZenStackClient<typeof schema>>;

  constructor(private readonly configService: ConfigService) { }

  async onModuleInit() {
    const connectionString = this.configService.getOrThrow<string>('DATABASE_URL');

    this.pool = new Pool({
      connectionString,
      max: 20,
    });

    this.pool.on('error', (err) => {
      this.logger.error('Unexpected error on idle pg client', err);
    });

    this.client = new ZenStackClient(schema, {
      dialect: new PostgresDialect({ pool: this.pool }),
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
