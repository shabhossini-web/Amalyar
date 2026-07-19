import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

/**
 * ورود با اثر انگشت / پس‌کی (WebAuthn، discoverable credential).
 * چالش‌ها به‌صورتِ stateless در یک JWT کوتاه‌عمر حمل می‌شوند.
 * env: RP_ID (پیش‌فرض amalyar.com) · WEBAUTHN_ORIGINS (کاما جدا)
 */
@Injectable()
export class WebauthnService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private auth: AuthService,
  ) {}

  private rpID = process.env.RP_ID || 'amalyar.com';
  private origins = (process.env.WEBAUTHN_ORIGINS || 'https://amalyar.com,https://www.amalyar.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // ── ثبتِ اثر انگشت (کاربرِ واردشده) ─────────────────────────
  async registerOptions(accountId: number) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: { credentials: true },
    });
    if (!account) throw new UnauthorizedException();

    const options = await generateRegistrationOptions({
      rpName: 'عمل‌یار',
      rpID: this.rpID,
      userName: account.username || account.phone || `user${account.id}`,
      userDisplayName:
        [account.firstName, account.lastName].filter(Boolean).join(' ') || account.username || '',
      attestationType: 'none',
      excludeCredentials: account.credentials.map((c) => ({
        id: c.credId,
        transports: c.transports ? JSON.parse(c.transports) : undefined,
      })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });

    const challengeToken = await this.jwt.signAsync(
      { purpose: 'webauthn-reg', sub: accountId, challenge: options.challenge },
      { expiresIn: '5m' },
    );
    return { options, challengeToken };
  }

  async registerVerify(accountId: number, body: { response: any; challengeToken: string }) {
    const payload = await this.checkChallenge(body.challengeToken, 'webauthn-reg');
    if (payload.sub !== accountId) throw new BadRequestException('توکنِ چالش نامعتبر است');

    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: payload.challenge,
      expectedOrigin: this.origins,
      expectedRPID: this.rpID,
    }).catch(() => null);
    if (!verification?.verified || !verification.registrationInfo) {
      throw new BadRequestException('ثبتِ اثر انگشت ناموفق بود');
    }

    const { credential } = verification.registrationInfo;
    await this.prisma.webauthnCredential.upsert({
      where: { credId: credential.id },
      create: {
        accountId,
        credId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64'),
        counter: credential.counter,
        transports: JSON.stringify(credential.transports ?? []),
      },
      update: { counter: credential.counter },
    });
    return { ok: true };
  }

  // ── ورود با اثر انگشت (بدونِ نام کاربری — discoverable) ─────
  async loginOptions() {
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'preferred',
    });
    const challengeToken = await this.jwt.signAsync(
      { purpose: 'webauthn-auth', challenge: options.challenge },
      { expiresIn: '5m' },
    );
    return { options, challengeToken };
  }

  async loginVerify(body: { response: any; challengeToken: string }, meta: { ua?: string; ip?: string }) {
    const payload = await this.checkChallenge(body.challengeToken, 'webauthn-auth');

    const cred = await this.prisma.webauthnCredential.findUnique({
      where: { credId: body.response?.id ?? '' },
      include: { account: true },
    });
    if (!cred) throw new UnauthorizedException('اثر انگشتِ ثبت‌شده‌ای یافت نشد');
    if (cred.account.status !== 'active') throw new UnauthorizedException('حساب فعال نیست');

    const verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: payload.challenge,
      expectedOrigin: this.origins,
      expectedRPID: this.rpID,
      credential: {
        id: cred.credId,
        publicKey: new Uint8Array(Buffer.from(cred.publicKey, 'base64')),
        counter: cred.counter,
        transports: cred.transports ? JSON.parse(cred.transports) : undefined,
      },
    }).catch(() => null);
    if (!verification?.verified) throw new UnauthorizedException('تأییدِ اثر انگشت ناموفق بود');

    await this.prisma.webauthnCredential.update({
      where: { id: cred.id },
      data: { counter: verification.authenticationInfo.newCounter },
    });
    return this.auth.issue(cred.account, meta);
  }

  async status(accountId: number) {
    const count = await this.prisma.webauthnCredential.count({ where: { accountId } });
    return { enabled: count > 0, count };
  }

  private async checkChallenge(token: string, purpose: string) {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new BadRequestException('چالش منقضی شده؛ دوباره تلاش کنید');
    }
    if (payload?.purpose !== purpose || !payload?.challenge) {
      throw new BadRequestException('توکنِ چالش نامعتبر است');
    }
    return payload;
  }
}
