/**
 * پاسخِ پرسشِ امنیتیِ ثبت‌نام برای **آزمون** — `server/src/patients/intake-captcha.ts`.
 *
 * صفحه تصویر نشان می‌دهد و پاسخ فقط رمزشده در نشان است؛ آزمون همان رازِ سرور (`JWT_SECRET`)
 * را دارد و نشان را باز می‌کند — دری که ربات ندارد. جای «دو عددی که آزمون خودش انتخاب می‌کرد».
 *
 *   body: { firstName, …, ...(await captchaFor(API, linkToken)) }
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../server/package.json', import.meta.url));
const { openChallenge } = require('./dist/patients/intake-captcha.js');

export async function captchaFor(api, linkToken, headers = {}) {
  const r = await fetch(`${api}/public/intake/link/${linkToken}/captcha`, { headers });
  const c = await r.json().catch(() => null);
  if (!r.ok || !c?.challenge) throw new Error(`پرسشِ امنیتی نیامد (${r.status}): ${JSON.stringify(c)}`);
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET برای باز کردنِ نشانِ پرسش لازم است');
  const opened = openChallenge(secret, c.challenge);
  if (!opened) throw new Error('نشانِ پرسش با این JWT_SECRET باز نشد — آزمون و سرور رازِ یکسان ندارند');
  return { captchaToken: c.challenge, captchaAnswer: opened.a };
}
