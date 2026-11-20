import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { auth } from './auth/auth.js';
import { ValidationPipe } from '@nestjs/common';
import { GlobalExceptionFilter } from './filters/global-exception.filter.js';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    rawBody: true,
  });

  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigins = isProduction
    ? [process.env.FRONTEND_URL].filter(Boolean)
    : [process.env.FRONTEND_URL || 'http://localhost:3001', 'http://localhost:3000'];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  // zenstack error exception filter 
  app.useGlobalFilters(new GlobalExceptionFilter());

  // helmet initiation for the security headers
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }))

  // swagger setup for the api documentation
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('LMS API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    const authSchema = await auth.api.generateOpenAPISchema();

    const allowedAuthPaths = new Set([
      '/sign-in/email',
      '/sign-up/email',
      '/sign-out',
      '/get-session',
      '/change-password',
      '/forget-password',
      '/reset-password',
      '/change-email',
      '/admin/set-role',
      '/admin/list-users',
    ]);

    if (authSchema?.paths) {
      for (const [path, pathItem] of Object.entries(authSchema.paths)) {
        if (allowedAuthPaths.has(path)) {
          document.paths[`/api/auth${path}`] = pathItem as any;
        }
      }
    }

    if (authSchema?.components) {
      document.components = {
        ...document.components,
        ...authSchema.components,
        schemas: {
          ...document.components?.schemas,
          ...authSchema.components?.schemas,
        },
      } as any;
    }

    SwaggerModule.setup('api', app, document);
  }

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();

