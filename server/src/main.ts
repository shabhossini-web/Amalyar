import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // همهٔ مسیرها زیرِ /api (هم‌راستا با نسخهٔ PHP و فرانتِ React)
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const origins = (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim());
  app.enableCors({ origin: origins.includes('*') ? true : origins, credentials: true });
  const port = parseInt(process.env.PORT || '3001', 10);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`amalyar-server ← http://0.0.0.0:${port}/api`);
}
bootstrap();
