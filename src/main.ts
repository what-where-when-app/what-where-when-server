import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useStaticAssets(join(process.cwd(), 'public'));
  const origin: Array<string | RegExp> = ['http://localhost:8081'];

  if (process.env.CLIENT_PUBLIC_API_URL) {
    origin.push(process.env.CLIENT_PUBLIC_API_URL);
  }

  const cloudflareRegex = /^https?:\/\/([a-z0-9]+)\.wwwclient\.pages\.dev$/;
  origin.push(cloudflareRegex);
  app.enableCors({
    origin: origin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
