/**
 * حسابی که مدیر برای کارشناس می‌سازد باید **قابلِ تحویل‌گرفتن** باشد.
 *
 * باگِ واقعی: `createTechnician` هشِ تصادفی می‌گذاشت، پس نه کسی می‌توانست وارد
 * شود (رمز را کسی نمی‌دانست و بازیابیِ رمز وجود ندارد) و نه ثبت‌نامِ دوباره
 * قبول می‌شد («این شماره قبلاً ثبت شده است») — شماره تا ویرایشِ دستیِ دیتابیس
 * قفل می‌ماند.
 *
 * پنج ادعا:
 *  ۱. مدیر کارشناس می‌سازد و او بلافاصله در فهرستِ `/techs` می‌آید.
 *  ۲. ورود با هر رمزی بسته است (حسابِ تصاحب‌نشده).
 *  ۳. صاحبِ شماره می‌تواند کدِ ثبت‌نام بگیرد — «تکراری» نمی‌گیرد.
 *  ۴. تصاحب سطح و وضعیتِ تعیین‌شدهٔ مدیر را **عوض نمی‌کند** و مستقیم واردش می‌کند.
 *  ۵. حسابِ تصاحب‌شده دیگر تصاحب‌پذیر نیست (ضدِ تصرفِ حساب).
 *
 * پیش‌نیازها: `scripts/e2e/README.md`. متغیر: `E2E_API` (پیش‌فرض 3009).
 */
const API = process.env.E2E_API ?? 'http://127.0.0.1:3009/api';
const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? '  ok ' : 'FAIL '} ${name}${extra ? ` — ${extra}` : ''}`);
};

async function j(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  let data = null; try { data = t ? JSON.parse(t) : null; } catch { data = t; }
  return { status: res.status, data };
}

const SELFIE = 'data:image/png;base64,' + 'A'.repeat(64);
/**
 * ⚠️ `code` را می‌شود از بیرون داد: سرور بینِ دو درخواستِ کد فاصله می‌خواهد
 * («کمی صبر کنید»)، پس سنجه‌ای که خودش قبلاً کد گرفته باید همان را بدهد نه
 * اینکه دوباره بخواهد — وگرنه تست به محدودیتِ نرخ می‌خورد نه به رفتارِ محصول.
 */
async function signup(phone, username, password, firstName = 'آزمون', lastName = 'کارشناس', code = null) {
  let devCode = code;
  if (!devCode) {
    const r1 = await j('/auth/signup/request-otp', { method: 'POST', body: { phone } });
    if (!r1.data?.devCode) return { step: 'otp', ...r1 };
    devCode = r1.data.devCode;
  }
  const r2 = await j('/auth/signup/verify-otp', { method: 'POST', body: { phone, code: devCode } });
  if (!r2.data?.signupToken) return { step: 'verify', ...r2 };
  const r3 = await j('/auth/signup/complete', {
    method: 'POST',
    body: { signupToken: r2.data.signupToken, firstName, lastName, username, password, selfie: SELFIE },
  });
  return { step: 'complete', ...r3 };
}

(async () => {
  // سوپرادمینِ اول
  const admin = await signup('09120000001', 'claimadmin', 'Passw0rd!');
  const adminLogin = await j('/auth/login', { method: 'POST', body: { identifier: 'claimadmin', password: 'Passw0rd!' } });
  const token = adminLogin.data?.accessToken;
  ok('سوپرادمین ساخته و وارد شد', !!token, `signup=${admin.status} login=${adminLogin.status}`);

  const PHONE = '09120000077';
  const made = await j('/accounts/technicians', {
    method: 'POST', token,
    body: { firstName: 'مریم', lastName: 'کارشناس', phone: PHONE },
  });
  ok('① مدیر کارشناس می‌سازد', made.status === 201 || made.status === 200, `status=${made.status}`);

  const techs = await j('/techs', { token });
  ok('① کارشناس بلافاصله در فهرستِ چینش هست',
    Array.isArray(techs.data) && techs.data.some((t) => String(t.displayName).includes('مریم')),
    `n=${techs.data?.length}`);

  const guess = await j('/auth/login', { method: 'POST', body: { identifier: PHONE, password: 'Passw0rd!' } });
  ok('② ورود به حسابِ تصاحب‌نشده بسته است', guess.status === 401, `status=${guess.status}`);

  const otp = await j('/auth/signup/request-otp', { method: 'POST', body: { phone: PHONE } });
  ok('③ صاحبِ شماره کدِ ثبت‌نام می‌گیرد', otp.status === 201 || otp.status === 200,
    `status=${otp.status} ${otp.data?.message ?? ''}`);

  const claim = await signup(PHONE, 'maryam.tech', 'Str0ngPass!', 'مریم', 'کارشناس', otp.data?.devCode);
  ok('④ تصاحب انجام شد', claim.status === 201 || claim.status === 200, `step=${claim.step} status=${claim.status}`);
  ok('④ بدونِ انتظارِ تأیید مستقیم وارد شد', claim.data?.pending === false && !!claim.data?.accessToken);
  /* ⚠️ مهم‌ترین سنجهٔ امنیتی: تصاحب نباید سطح بدهد. اگر می‌داد، هر کس با یک
     شمارهٔ از پیش ثبت‌شده می‌توانست سطحِ خودش را بالا ببرد. */
  ok('④ سطحِ تعیین‌شدهٔ مدیر عوض نشد (کارشناس، نه سوپرادمین)', claim.data?.user?.level === 2,
    `level=${claim.data?.user?.level}`);

  const relogin = await j('/auth/login', { method: 'POST', body: { identifier: PHONE, password: 'Str0ngPass!' } });
  ok('④ پس از تصاحب با رمزِ خودش وارد می‌شود', !!relogin.data?.accessToken, `status=${relogin.status}`);

  const again = await j('/auth/signup/request-otp', { method: 'POST', body: { phone: PHONE } });
  ok('⑤ حسابِ تصاحب‌شده دوباره تصاحب‌پذیر نیست', again.status === 400, `status=${again.status}`);

  /* ⚠️ نگهبانِ ضدِ‌رگرسیون برای همان تغییر: بازگشتِ ثبت‌نام از `bootstrap` به
     «وضعیتِ حساب» عوض شد. ثبت‌نامِ عادی (نه تصاحب، نه اولین حساب) باید هنوز
     `pending` بدهد و **توکن ندهد** — وگرنه هر غریبه‌ای بی‌تأییدِ مدیر وارد می‌شود. */
  const stranger = await signup('09120000088', 'stranger', 'Passw0rd!', 'ناشناس', 'کاربر');
  ok('⑥ ثبت‌نامِ عادی هنوز در انتظارِ تأیید می‌ماند',
    stranger.data?.pending === true && !stranger.data?.accessToken,
    `pending=${stranger.data?.pending} token=${!!stranger.data?.accessToken}`);
  const strangerLogin = await j('/auth/login', { method: 'POST', body: { identifier: 'stranger', password: 'Passw0rd!' } });
  ok('⑥ کاربرِ تأییدنشده وارد نمی‌شود', strangerLogin.status !== 201 && !strangerLogin.data?.accessToken,
    `status=${strangerLogin.status}`);

  /* ── نشتِ اطلاعاتِ حسابِ بانکی از گاردِ حسابداری ──────────────
     `billing.read` سطحِ سوپروایزر است ولی `/bank-accounts` سطحِ ادمین؛
     `invoiceBankAccount: true` کلِ ردیف را می‌داد و شمارهٔ کارت از این مسیر
     بیرون می‌رفت. حالا فقط پنج قلمِ مصرف‌شونده برمی‌گردد. */
  /**
   * مراجعه سه تعریفِ پایه لازم دارد (پزشک/بیمارستان/نوعِ عمل).
   *
   * ⚠️ «بگیر یا بساز»، نه «بساز»: `TRUNCATE`ِ ابتدای ران فقط حساب‌ها را پاک
   * می‌کند، پس تعاریفِ رانِ قبلی سرِ جایشان می‌مانند و ساختِ دوباره با «این
   * نام قبلاً ثبت شده است» رد می‌شود. سنجه‌ای که فقط بارِ اول سبز باشد سنجه
   * نیست.
   */
  const ensure = async (path, body, match) => {
    const made = await j(path, { method: 'POST', token, body });
    if (made.data?.id) return made.data.id;
    const list = await j(path, { token });
    const rows = Array.isArray(list.data) ? list.data : (list.data?.rows ?? []);
    return rows.find(match)?.id;
  };
  const surgeonId = await ensure('/surgeons', { firstName: 'دکتر', lastName: 'آزمون' },
    (r) => String(r.name ?? '').includes('آزمون'));
  const hospitalId = await ensure('/hospitals', { name: 'بیمارستانِ آزمون' },
    (r) => r.name === 'بیمارستانِ آزمون');
  const ptypeId = await ensure('/procedure-types', { name: 'عملِ آزمون' },
    (r) => r.name === 'عملِ آزمون');
  ok('⑦ تعاریفِ پایه آماده‌اند', !!(surgeonId && hospitalId && ptypeId),
    `surgeon=${surgeonId} hospital=${hospitalId} ptype=${ptypeId}`);
  const visit = await j('/visits', {
    method: 'POST', token,
    body: {
      firstName: 'بیمارِ', lastName: 'آزمون', opDate: new Date().toISOString(),
      surgeonId, hospitalId, procedureTypeId: ptypeId,
    },
  });
  const banks = await j('/bank-accounts', { token });
  let bankId = banks.data?.[0]?.id;
  if (!bankId) {
    const mk = await j('/bank-accounts', {
      method: 'POST', token,
      body: { ownerName: 'شرکتِ آزمون', bankName: 'ملت', cardNumber: '6104337712345678',
              iban: 'IR820540102680020817909002', accountNumber: '1234567890', classification: 'formal' },
    });
    bankId = mk.data?.id;
  }
  const visitId = visit.data?.id;
  if (visitId && bankId) {
    const bind = await j(`/visits/${visitId}/billing/invoice-account`, {
      method: 'POST', token, body: { invoiceType: 'formal', bankAccountId: bankId },
    });
    ok('⑦ اتصالِ حسابِ فاکتور', bind.status === 200 || bind.status === 201,
      `status=${bind.status} ${JSON.stringify(bind.data)?.slice(0, 140)}`);
    const bill = await j(`/visits/${visitId}/billing`, { token });
    const acc = bill.data?.invoiceBankAccount;
    ok('⑦ حسابِ فاکتور در صورت‌حساب می‌آید', !!acc, `keys=${acc ? Object.keys(acc).join(',') : '—'}`);
    ok('⑦ شمارهٔ کارت در صورت‌حساب نیست', acc ? !('cardNumber' in acc) : false);
    ok('⑦ هیچ قلمِ داخلی (یادداشت/شریک) بیرون نمی‌رود',
      acc ? !('notes' in acc) && !('partnerId' in acc) && !('showOnIntake' in acc) : false,
      acc ? Object.keys(acc).join(',') : '—');
  } else {
    ok('⑦ سناریوی حسابِ فاکتور آماده شد', false,
      `visit=${visitId} bank=${bankId} visitStatus=${visit.status} ${JSON.stringify(visit.data)?.slice(0, 160)}`);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${failed.length ? `✗ ${failed.length} FAILED` : '✓ ALL PASS'} — ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e); process.exit(2); });
