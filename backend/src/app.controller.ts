import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { AllowAnonymous, Session, type UserSession } from '@thallesp/nestjs-better-auth';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  // health check 
  @Get()
  @AllowAnonymous()
  getHello() {
    return this.appService.getHello();
  }

  @Get('me')
  getMe(@Session() session: UserSession) {
    return {
      message: 'You are authenticated', user: session.user
    }
  }
}
