import { applyWordReplacements, parseWordReplacements, type WordRule } from '../sms/word-replacements';

/** One sender for the manual action and tenant worker. Never treat a stub or a claim as delivery. */
/* W2.2: outboxِ رویداد (CONTRACTS §۲) — sms.failed ← کارِ «ارسالِ دوباره»؛ sms.sent آن را می‌بندد. هرگز ارسال را نمی‌شکند. */
export async function emitSms(client: any, row: any, type: string, payload: Record<string, unknown>) {
  try {
    await client.domainEvent.create({ data: {
      type, patientId: row.patientId ?? null, visitId: row.visitId ?? null, appointmentId: row.appointmentId ?? null,
      refType: 'reminder', refId: row.id, payload: { kind: row.kind, ...payload },
    } });
  } catch { /* جدولِ رویداد هنوز migrate نشده یا خطای گذرا — یادآوری خودش ثبت شده است */ }
}
/**
 * لینکِ سفارشی (`/o/<توکن>`) که واقعاً رفت ← سفارشِ «پیش‌نویس» «فرستاده‌شده» می‌شود.
 *
 * ⚠️ گذارِ draft→sent باید به **رفتنِ پیامک** گره بخورد، نه به این‌که کدام مسیر فرستادش. وقتی دکمهٔ «ثبت و ارسال»
 * پیامک را رد می‌گرفت، ردیفِ «نرفت» + کارِ «ارسالِ دوباره» ساخته می‌شد؛ «ارسالِ دوباره» از همین تابع می‌گذرد و
 * لینک را واقعاً می‌رساند، ولی سفارش «پیش‌نویس» می‌ماند و صفحهٔ بیمار پاسخ و فایل را با ۴۰۹ رد می‌کرد. شمارهٔ
 * پرونده هم شرط است تا متنی که اتفاقاً شبیهِ لینک است سفارشِ کسِ دیگری را جلو نبرد. هرگز ارسال را نمی‌شکند.
 */
const ORDER_TABLES = ['labOrder', 'imagingOrder', 'consultOrder', 'referralOrder'];
const ORDER_LINK = /\/o\/([A-Za-z0-9_-]{16,64})(?![A-Za-z0-9_-])/;
export function orderTokenIn(text: unknown): string | null {
  return ORDER_LINK.exec(String(text ?? ''))?.[1] ?? null;
}
async function promoteOrderLink(client: any, row: any) {
  const token = row.kind === 'notice' ? orderTokenIn(row.text) : null;
  if (!token || !row.patientId) return;
  for (const t of ORDER_TABLES) {
    try {
      await client[t]?.updateMany({ where: { token, patientId: row.patientId, status: 'draft' }, data: { status: 'sent', sentAt: new Date() } });
    } catch { /* جدولِ آن نوع هنوز migrate نشده — پیام خودش رفته است */ }
  }
}
/**
 * سه تلاشِ دوباره با مکثِ ۵ → ۱۵ → ۴۵ دقیقه (قراردادِ §۸).
 *
 * ⚠️ سقف از خودِ آرایه مشتق می‌شود، نه عددِ جدا: اگر دو جا نوشته شوند، اولین
 * کسی که یک مکث اضافه کند مکثِ آخر را بی‌استفاده می‌گذارد (همین‌جا یک‌بار
 * نوشته شد و آخرین مکث هیچ‌وقت به کار نمی‌آمد).
 */
const BACKOFF_MIN = [5, 15, 45];
const MAX_ATTEMPTS = BACKOFF_MIN.length + 1;   // ارسالِ اول + سه تلاشِ دوباره
/** رقمِ فارسی برای متنی که کارکنان در دفتر می‌خوانند. */
const faNum = (n: number) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
const UNCERTAIN_TEXT = 'نتیجه ارسال مشخص نشد؛ پیش از ارسال مجدد در سرویس پیامک بررسی شود';

export async function sendReminders(client: any, sms: any, ids?: number[]) {
  await client.reminder.updateMany({ where: { status: 'sending', attemptedAt: { lt: new Date(Date.now() - 10 * 60000) } }, data: { status: 'uncertain', error: UNCERTAIN_TEXT } });
  /* W1.9/§۸ — `uncertain` تا امروز وضعیتِ **نهایی** بود: این تابع فقط
     `pending` را برمی‌دارد، پس پیامی که نتیجه‌اش نامعلوم مانده بود هیچ‌وقت
     دوباره امتحان نمی‌شد و بی‌سروصدا می‌ماند. حالا هر `uncertain`ی که موعدِ
     تلاشِ بعدی‌اش رسیده به صف برمی‌گردد. */
  await client.reminder.updateMany({
    where: { status: 'uncertain', attempts: { lt: MAX_ATTEMPTS }, dueAt: { lte: new Date() } },
    data: { status: 'pending' },
  });
  const due = await client.reminder.findMany({ where: { channel: 'sms', status: 'pending', dueAt: { lte: new Date() }, ...(ids ? { id: { in: ids } } : {}) }, orderBy: { dueAt: 'asc' }, take: ids ? 500 : 25 });
  /* «جایگزینیِ کلمه» (تنظیمات ← پیامک‌ها): یک‌بار برای کلِ این دور خوانده می‌شود و **هنگامِ ارسال** اعمال می‌شود؛
     متنِ ثبت‌شده در دفتر و کلیدِ یکتای یادآوری دست نمی‌خورد. خطای خواندن ارسال را نمی‌شکند. */
  let rules: WordRule[] = [];
  if (due.length) {
    try { rules = parseWordReplacements((await client.setting?.findUnique({ where: { key: 'sms_word_replacements' } }))?.value); } catch { rules = []; }
  }
  let sent = 0, failed = 0, skipped = 0;
  for (const row of due) {
    const claim = await client.reminder.updateMany({ where: { id: row.id, status: 'pending' }, data: { status: 'sending', attemptedAt: new Date(), error: null } });
    if (!claim.count) { skipped++; continue; }
    let accepted = false;
    try {
      if (!row.phone) throw new Error('شماره‌ای ثبت نشده');
      const result = await sms.send(row.phone, applyWordReplacements(row.text, rules));
      if (!result.sent && !result.stub) {
        /* `outcome` (بیرون از production): «rejected» = ملی‌پیامک نپذیرفت و دوباره امتحان
           می‌شود؛ «invalid» = شمارهٔ خراب، تکرارش بی‌فایده است. */
        throw Object.assign(new Error(result.detail ?? 'سرویس پیامک ارسال را نپذیرفت'), { smsOutcome: result.outcome, smsFiltered: result.filtered });
      }
      accepted = result.sent;
      await client.reminder.update({ where: { id: row.id }, data: { status: result.stub ? 'simulated' : 'sent', sentAt: result.sent ? new Date() : null, providerId: result.providerId ?? null, deliveryStatus: result.sent ? 'unknown' : 'not_sent', error: result.stub ? 'حالت آزمایشی؛ پیام واقعی ارسال نشده است' : null } });
      if (result.sent) sent++; else skipped++;
      if (result.sent) await emitSms(client, row, 'sms.sent', { providerId: result.providerId ?? null });
      await promoteOrderLink(client, row);
    } catch (e) {
      failed++;
      /* علتِ واقعی (`smsDetail`: کلید/خط تنظیم نیست، یا متنِ ردِ ملی‌پیامک)، نه پیامِ
         عمومیِ «موقتاً در دسترس نیست» — این دفتر را فقط کارکنان می‌بینند. */
      const reason = String((e as any)?.smsDetail ?? (e instanceof Error ? e.message : e));
      const outcome = (e as any)?.smsOutcome;
      const uncertain = accepted || outcome === 'unknown';
      /* ردِ ملی‌پیامک (یا کلید/خطِ تنظیم‌نشده) یعنی «قطعاً نرفت» — دوباره فرستادنش پیامِ
         تکراری نمی‌سازد، پس همان سه تلاش را می‌گیرد؛ این بار در صف (`pending`)، نه «نامعلوم».
         گزارشِ میدانی ۱۴۰۵/۰۷/۰۴: مراقبتِ بعد از عمل در لحظهٔ موعد رد شد و تا ابد «ناموفق»
         ماند، در حالی که «ارسالِ دوباره»ی دستیِ **همان متن** بعدتر رفت. شکستِ قطعیِ دیگر
         (شمارهٔ خراب، خطای برنامه) همچنان یک‌باره `failed` است. */
      const refused = !uncertain && (outcome === 'rejected' || outcome === 'unconfigured');
      /* ⚠️ «متن حاوی کلمهٔ فیلترشده» استثنای همین قاعده است: به **متن** گره خورده، نه به لحظه. گزارشِ میدانی
         ۱۴۰۵/۰۷/۲۸ (dr-gorji): هر چهار تلاشِ مراقبتِ بعد از عمل با همین علت رد شد — یک ساعت صبر برای چیزی که
         نمی‌رود، و کارِ منشی هم تا تلاشِ آخر ساخته نمی‌شد. حالا همان بارِ اول «نرفت» و علتش «متن را اصلاح کنید». */
      const filtered = refused && (e as any)?.smsFiltered === true;
      const attempts = (row.attempts ?? 0) + 1;
      /* تلاشِ بعدی: ۵ → ۱۵ → ۴۵ دقیقه. بعد از سومی دیگر تکرار نمی‌شود،
         `failed` می‌شود و `sms.failed` صادر می‌شود تا کسی ببیندش. */
      const retry = (uncertain || refused) && !filtered && attempts < MAX_ATTEMPTS;
      const nextDue = retry ? new Date(Date.now() + BACKOFF_MIN[attempts - 1] * 60000) : undefined;
      /* علت همیشه پیداست؛ شمارهٔ تلاش **اول** می‌آید تا بریدنِ ۳۰۰ نویسه آن را نبرد. */
      const error = uncertain
        ? (retry ? UNCERTAIN_TEXT : 'پس از سه تلاش نتیجهٔ ارسال مشخص نشد')
        : filtered
          ? `${reason} — همین متن دوباره هم نمی‌رود؛ کلمه را عوض کنید`
        : refused
          ? (retry
            ? `تلاشِ ${faNum(attempts)} از ${faNum(MAX_ATTEMPTS)} نرفت و خودکار دوباره امتحان می‌شود — ${reason}`
            : `پس از ${faNum(attempts)} تلاش نرفت — ${reason}`)
          : reason;
      await client.reminder.update({
        where: { id: row.id },
        data: {
          attempts,
          status: retry ? (uncertain ? 'uncertain' : 'pending') : 'failed',
          ...(nextDue ? { dueAt: nextDue } : {}),
          sentAt: null,
          deliveryStatus: uncertain && retry ? 'unknown' : 'not_sent',
          error: error.slice(0, 300),
        },
      });
      /* ردی که هنوز تلاش دارد رویداد نمی‌سازد: کارِ «ارسالِ دوباره» (`sms.failed`) فقط وقتی
         به منشی می‌رسد که تلاش‌های خودکار تمام شده باشد. */
      if (!(refused && retry)) {
        await emitSms(client, row, retry ? 'sms.uncertain' : 'sms.failed', { error: reason.slice(0, 300), attempts, ...(filtered ? { filtered: true } : {}) });
      }
    }
  }
  return { due: due.length, sent, failed, skipped };
}
