import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { allowedOrigins } from './common/security';
import { restoreApiPrefix } from './common/api-prefix';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';

async function bootstrap() {
  // bodyParser را خودمان با سقفِ بالاتر می‌گذاریم (سلفیِ dataURL بزرگ است)
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '8mb' }));
  app.use(urlencoded({ extended: true, limit: '8mb' }));

  // Coolify path routing strips the matched /api prefix before proxying.
  // Restore it so Nest's global prefix and the public same-origin API contract
  // remain stable for every tenant hostname.
  app.use((req: any, _res: any, next: any) => {
    req.url = restoreApiPrefix(req.url);
    next();
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // نقضِ یکتایی و «رکورد نیست» باید پیامِ روشن بدهند، نه 500 خام.
  app.useGlobalFilters(new PrismaExceptionFilter());
  const origins = allowedOrigins();
  app.enableCors({ origin: origins, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] });

  // Security headers without adding runtime dependencies.
  app.use((_req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  const port = parseInt(process.env.PORT || '3001', 10);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`amalyar-server ← http://0.0.0.0:${port}/api`);
}
bootstrap();
