import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { CompleteSignupDto } from './dto/complete-signup.dto';
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

  @Post('signup/verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifySignupOtp(dto);
  }

  @Post('signup/complete')
  completeSignup(@Body() dto: CompleteSignupDto, @Req() req: Request) {
    return this.auth.completeSignup(dto, { ua: req.headers['user-agent'], ip: req.ip });
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
