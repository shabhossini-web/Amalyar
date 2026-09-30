import {
  Body, Controller, ForbiddenException, Get, Patch, Post, Req, Res, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IsInt, IsOptional } from 'class-validator';
import { AuthService } from './auth.service';
import { WebauthnService } from './webauthn.service';
import { LoginDto } from './dto/login.dto';
import { WebauthnLoginOptionsDto, WebauthnVerifyDto } from './dto/webauthn.dto';
import { ChangePasswordDto, UpdatePrefsDto, UpdateProfileDto } from './dto/profile.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { CompleteSignupDto } from './dto/complete-signup.dto';
import { PasswordResetDto, PasswordResetRequestDto } from './dto/password-reset.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { clearSessionCookies, csrfMatches, setSessionCookies } from './session-cookie';
import { clientIp } from '../common/client-ip';

class SwitchDto {
  @IsInt() accountId!: number;
}
class LogoutDto {
  /** خروجِ حسابِ **غیرفعالِ** مجموعه؛ خالی = خروجِ حسابِ جاری. */
  @IsOptional() @IsInt() accountId?: number;
}

/* نشانیِ بازدیدکننده از `clientIp` (تهِ X-Forwarded-For)، نه `req.ip`: پشتِ Traefik `req.ip` نشانیِ خودِ پراکسی است
   و سقفِ نرخِ ورود/ثبت‌نام/بازیابی برای همهٔ کاربرانِ همهٔ شرکت‌ها یک سطل می‌شد (بستهٔ PF، PF2). */
const meta = (req: Request) => ({ ua: req.headers['user-agent'], ip: clientIp(req) });

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private webauthn: WebauthnService,
  ) {}

  /**
   * ورودِ موفق → کوکیِ نشست (+ عضویت در مجموعهٔ چندحسابی اگر «به خاطر بسپار»).
   * بدنهٔ JSON همچنان توکن را دارد — برای کلاینت‌های Bearer؛ اپِ مرورگر
   * آن را ذخیره نمی‌کند (`session-cookie.ts`).
   */
  private async attach(req: Request, res: Response, r: { accessToken: string; sid: string; user: any }, remember: boolean) {
    const csrfToken = setSessionCookies(res, r.accessToken, remember);
    if (remember) {
      const rest = (await this.auth.readSessionSet(req)).filter((e) => e.sub !== r.user.id);
      await this.auth.writeSessionSet(res, [{ sid: r.sid, sub: r.user.id }, ...rest]);
    }
    return { ...r, csrfToken };
  }

  @Get('setup-status')
  setupStatus() {
    return this.auth.setupStatus();
  }

  @Post('signup/request-otp')
  requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    return this.auth.requestSignupOtp(dto.phone, clientIp(req));
  }

  @Post('signup/verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    return this.auth.verifySignupOtp(dto, clientIp(req));
  }

  @Post('signup/complete')
  async completeSignup(@Body() dto: CompleteSignupDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r: any = await this.auth.completeSignup(dto, meta(req));
    return r.accessToken ? this.attach(req, res, r, true) : r;
  }

  /* بازیابیِ رمز (بازبینیِ UX، بندِ ۱۹) — بی‌احراز مثلِ ثبت‌نام؛ پاسخِ درخواست برای حسابِ موجود و ناموجود یکی است. */
  @Post('password/request-otp')
  requestPasswordReset(@Body() dto: PasswordResetRequestDto, @Req() req: Request) {
    return this.auth.requestPasswordReset(dto.identifier, clientIp(req));
  }

  @Post('password/reset')
  resetPassword(@Body() dto: PasswordResetDto, @Req() req: Request) {
    return this.auth.resetPassword(dto, meta(req));
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(dto, meta(req));
    return this.attach(req, res, r, dto.remember !== false);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: any) {
    return this.auth.publicUser(user);
  }

  /** حساب‌های «به خاطر سپرده‌شدهٔ» این مرورگر — زنده‌ها؛ مرده‌ها همین‌جا از کوکی پاک می‌شوند. */
  @UseGuards(JwtAuthGuard)
  @Get('accounts')
  async accounts(@CurrentUser() user: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const set = await this.auth.readSessionSet(req);
    const live = await this.auth.liveSet(set);
    if (live.length !== set.length) await this.auth.writeSessionSet(res, live.map((l) => l.entry));
    return live.map((l) => ({ ...this.auth.publicUser(l.account), active: l.entry.sid === user.sid }));
  }

  /**
   * سوییچ به حسابِ دیگرِ مجموعه — سمتِ سرور.
   *
   * عمداً بدونِ `JwtAuthGuard`: وقتی نشستِ فعال مُرده (۴۰۱)، کلاینت باید بتواند
   * به حسابِ زندهٔ بعدی برود. اعتبارنامه همان کوکیِ HttpOnlyِ مجموعه است که
   * فقط نشست‌های از قبل احرازشده را دارد؛ نشانِ CSRF هم الزامی است تا سایتِ
   * دیگری نتواند حسابِ فعالِ کاربر را عوض کند.
   */
  @Post('switch')
  async switchTo(@Body() dto: SwitchDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!csrfMatches(req)) throw new ForbiddenException('نشانِ امنیتیِ درخواست معتبر نیست؛ صفحه را تازه کنید');
    const set = await this.auth.readSessionSet(req);
    const entry = set.find((e) => e.sub === dto.accountId);
    if (!entry) throw new UnauthorizedException('این حساب روی این دستگاه وارد نشده؛ دوباره وارد شوید');
    const account = await this.auth.validateSession(entry.sid, entry.sub);
    if (!account) {
      await this.auth.writeSessionSet(res, set.filter((e) => e.sub !== dto.accountId));
      throw new UnauthorizedException('نشستِ این حساب منقضی شده؛ دوباره وارد شوید');
    }
    const csrfToken = setSessionCookies(res, await this.auth.tokenFor(entry.sid, account), true);
    return { ...this.auth.publicUser(account), csrfToken };
  }

  /**
   * خروج. بدونِ `accountId` = حسابِ جاری: نشستش باطل می‌شود و اگر حسابِ زندهٔ
   * دیگری در مجموعه هست، همان فعال می‌شود (`next`)؛ وگرنه کوکی‌ها پاک.
   * با `accountId`ِ حسابِ دیگر = فقط آن از مجموعه خارج می‌شود.
   */
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@CurrentUser() user: any, @Body() dto: LogoutDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const set = await this.auth.readSessionSet(req);
    if (dto?.accountId && dto.accountId !== user.id) {
      await this.auth.revokeMany(set.filter((e) => e.sub === dto.accountId).map((e) => e.sid));
      const rest = set.filter((e) => e.sub !== dto.accountId);
      await this.auth.writeSessionSet(res, rest);
      return { ok: true, next: this.auth.publicUser(user) };
    }
    await this.auth.logout(user.sid);
    const rest = set.filter((e) => e.sid !== user.sid && e.sub !== user.id);
    if ((req as any).authVia !== 'cookie') return { ok: true, next: null };
    const live = await this.auth.liveSet(rest);
    if (!live.length) {
      clearSessionCookies(res);
      return { ok: true, next: null };
    }
    const n = live[0];
    const csrfToken = setSessionCookies(res, await this.auth.tokenFor(n.entry.sid, n.account), true);
    await this.auth.writeSessionSet(res, live.map((l) => l.entry));
    return { ok: true, next: { ...this.auth.publicUser(n.account), csrfToken } };
  }

  /** خروج از همهٔ حساب‌های این مرورگر — نشست‌های سرور هم باطل می‌شوند. */
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const set = await this.auth.readSessionSet(req);
    await this.auth.revokeMany([...new Set([user.sid, ...set.map((e) => e.sid)])]);
    clearSessionCookies(res);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  updateProfile(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user.id, dto);
  }

  /** منتخب‌های شخصی — «فرمِ منتخب» و «ابزارکِ منتخب» (۱۴۰۵/۰۷/۰۳). */
  @UseGuards(JwtAuthGuard)
  @Get('prefs')
  prefs(@CurrentUser() user: any) {
    return this.auth.prefs(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('prefs')
  setPrefs(@CurrentUser() user: any, @Body() dto: UpdatePrefsDto) {
    return this.auth.setPrefs(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('phone/request-otp')
  requestPhone(@CurrentUser() user: any, @Req() req: Request) { return this.auth.requestPhoneVerification(user, clientIp(req)); }

  @UseGuards(JwtAuthGuard)
  @Post('phone/verify-otp')
  verifyPhone(@CurrentUser() user: any, @Body() dto: VerifyOtpDto, @Req() req: Request) { return this.auth.verifyPhone(user, dto, clientIp(req)); }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@CurrentUser() user: any, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto.current, dto.next);
  }

  // ── اثر انگشت / پس‌کی ──────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('webauthn/status')
  webauthnStatus(@CurrentUser() user: any) {
    return this.webauthn.status(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('webauthn/register/options')
  webauthnRegOptions(@CurrentUser() user: any) {
    return this.webauthn.registerOptions(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('webauthn/register/verify')
  webauthnRegVerify(@CurrentUser() user: any, @Body() dto: WebauthnVerifyDto) {
    return this.webauthn.registerVerify(user.id, dto);
  }

  @Post('webauthn/login/options')
  webauthnLoginOptions(@Body() dto: WebauthnLoginOptionsDto) {
    return this.webauthn.loginOptions(dto.credIds);
  }

  @Post('webauthn/login/verify')
  async webauthnLoginVerify(@Body() dto: WebauthnVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.webauthn.loginVerify(dto, meta(req));
    return this.attach(req, res, r, dto.remember !== false);
  }
}
