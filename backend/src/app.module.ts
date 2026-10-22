import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from '@nestjs/config';
import { DbPoolModule } from './db-pool/db-pool.module.js';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './auth/auth.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env']
    }),
    DbPoolModule,
    AuthModule.forRoot({ auth })
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
