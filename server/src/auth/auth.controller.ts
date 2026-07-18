import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifySignupDto } from './dto/verify-signup.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Get('setup-status')
  setupStatus() {
    return this.auth.setupStatus();
  }

  @Post('signup/request-otp')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestSignupOtp(dto.phone);
  }

  @Post('signup/verify')
  verifySignup(@Body() dto: VerifySignupDto, @Req() req: Request) {
    return this.auth.verifySignup(dto, { ua: req.headers['user-agent'], ip: req.ip });
  }

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, { ua: req.headers['user-agent'], ip: req.ip });
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: any) {
    return this.auth.publicUser(user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@CurrentUser() user: any) {
    return this.auth.logout(user.sid);
  }
}
