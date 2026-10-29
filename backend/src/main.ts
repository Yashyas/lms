import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { auth } from './auth/auth.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });

  app.enableCors({
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:3001',
      'http://localhost:3000',
    ],
    credentials: true,
  });

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

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();

