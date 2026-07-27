import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** فیلدهایی که یکتایی‌شان معنایِ کاربری دارد → پیامِ فارسیِ مشخص. */
const UNIQUE_MESSAGES: Record<string, string> = {
  national_id: 'این کد ملی قبلاً برای شخصِ دیگری ثبت شده است',
  phone: 'این شمارهٔ موبایل قبلاً ثبت شده است',
  username: 'این نام کاربری قبلاً گرفته شده است',
  name: 'این نام قبلاً ثبت شده است',
  title: 'این عنوان قبلاً ثبت شده است',
  code: 'این کد قبلاً ثبت شده است',
};

/**
 * خطاهای شناخته‌شدهٔ Prisma به پاسخِ کاربرپسند تبدیل می‌شوند.
 *
 * بدونِ این فیلتر، نقضِ یکتاییِ کد ملی «Internal server error» می‌داد — کاربر
 * نمی‌فهمید چه چیزی را باید اصلاح کند و لاگِ سرور هم بی‌دلیل پر از خطا می‌شد.
 * پیام هرگز نامِ جدول یا متنِ خامِ خطا را لو نمی‌دهد.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (error.code === 'P2002') {
      const target = error.meta?.target;
      const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
      const known = fields.map((f) => UNIQUE_MESSAGES[f]).find(Boolean);
      return res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: known ?? 'این مقدار تکراری است',
      });
    }

    if (error.code === 'P2025') {
      return res.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: 'رکورد موردنظر پیدا نشد',
      });
    }

    // بقیهٔ کدها ناشناخته‌اند؛ جزئیاتشان نباید به کاربر برسد.
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'خطای غیرمنتظره در پردازش درخواست',
    });
  }
}
