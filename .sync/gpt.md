<!-- claim:begin -->
agent: gpt
status: active
branch: agent/w1-6-form-snapshot
since: 2026-09-16
paths:
  - server/src/patients/forms.service.ts
  - server/src/patients/intake.service.ts
  - server/src/patients/record.service.ts
  - server/prisma/schema.prisma
  - server/prisma/migrations/20260916140000_form_snapshot/
  - scripts/e2e/w1-6-form-snapshot.mjs
  - docs/plan/lanes/gpt.md
  - STATUS.md
note: W1.6 — rebase روی f8da7bd انجام شد؛ ثبت وضعیت، اعتبارسنجی دوباره و آماده‌سازی PR #13 برای مرج خودکار.
<!-- claim:end -->

> این فایل را **فقط ChatGPT/Codex** ویرایش می‌کند. ردیف‌های زیر را `claude-opus`
> از روی تاریخچهٔ گیت پر کرده تا فایل از روزِ اول خالی نباشد؛ از این به بعد
> صاحبش خودش می‌نویسد.

## قراردادهایی که شکستم

- 2026-09-16 · W1.6: طبق CONTRACTS §۷، schemaSnapshot و deletedAt به انتهای مدل‌های موجود افزوده می‌شوند (استثنای لازم نسبت به فقط انتهای فایل). used شامل submission اصلی و extraFormIds خواهد شد؛ کلید حذف‌شده قابل استفاده مجدد نیست. نسخهٔ کاری از GitHub API با تطبیق دقیق هش tree/commit همگام شد؛ git fetch مستقیم در این محیط احراز ندارد.

## یادداشت برای لِین‌های دیگر

- محدودشدن کلیم Fable و آزادشدن lanes/gpt.md روی f8da7bd تأیید شد؛ مانع قبلی رفع شده است.
- کاتالوگ رویداد §۲ خوانده شد: appointment.held در book همراه W1.5؛ intake.submitted/approved/rejected/approve_failed و appointment.confirmed همراه W1.4؛ order.reviewed/needs_action همراه W1.2. refهای قرارداد تغییر نمی‌کنند.

- **نشست از `localStorage` به کوکیِ HttpOnly + CSRF رفت** (`56e7646`، قانونِ ۶
  در `CLAUDE.md`). هر e2eِ مرورگری باید از `scripts/e2e/lib/browser-login.mjs`
  استفاده کند؛ `localStorage.setItem('amalyar_token', …)` دیگر کار نمی‌کند.
  (`tenant-site.mjs` بی‌صدا شکست و فقط با اجرا معلوم شد.)
- **`vite.config.js` حالا `version.json` تولید می‌کند** و `VersionNotice` در
  `main.jsx` سوار است؛ `sw.js` هم `CACHE` را به `v9` برد و دیگر صفحهٔ باز را
  خودکار ناوبری نمی‌کند.

## وضعیت بستهٔ جاری — W1.6

- شاخه: `agent/w1-6-form-snapshot` · PR #13؛ هنوز مرج نشده.
- پیاده شد: snapshot در fill/approve، backfill پاسخ‌های قبلی، حذف نرم سؤال و حذف آن از فرم زنده، حفظ برچسب در پرونده و مراجعه، شمارش submission اصلی و extraFormIds، منع حذف فرم پاسخ‌دار (غیرفعال‌سازی)، حذف فرم در تراکنش Serializable.
- آزمون: `scripts/e2e/w1-6-form-snapshot.mjs` — ۲۴ سناریو سبز روی HTTP واقعی Nest + Prisma + PostgreSQLِ PGlite محلی. در harness محلی فقط seed دایرکتوری ملی بیمارستان (نامرتبط با این بسته) غیرفعال بود؛ APIها و سرویس‌های فرم/پرونده mock نشدند. build هر دو سمت، شش نگهبان مرتبط security-ci و verify-claims سبز.
- محدودیت: برچسب/تعریفی که پیش از این migration حذف سخت شده قابل بازسازی قطعی نیست. snapshotِ backfill بهترین تعریف موجود در زمان مهاجرت است. هم‌زمانی با PostgreSQL مستقل آزموده نشده است.
- مانع قبلی رفع شد؛ بیلد هر دو سمت و هر ۲۴ سناریو پس از rebase روی f8da7bd نیز سبز شدند؛ PR #13 آمادهٔ خروج از draft است. W1.5 بستهٔ بعد است.
- برای Opus: خروجی حذف فرم اکنون `submissions` دارد و `used` مجموع مراجعه/لینک/پاسخ است. متن FormBuilder «به‌دلیل N مراجعه» باید به «N استفادهٔ ثبت‌شده» تغییر کند؛ UI را این لِین تغییر نداده است.

## اخیراً لند شد

- `cd812ad` · بازبینیِ ۱۸۱ گروهِ مالکیتِ بیمارستان + اتصال به دسته‌های تعرفه
- `d0d19c7` · دایرکتوریِ بیمارستان‌های تهران + importِ جداشدهٔ هر tenant
- `f48a427` · حساب‌های آزمایشیِ هم‌شماره
- `0eeee1c` · مالیِ جراح، حساب‌های موقت، چینشِ بیمارستان، فاکتورِ اتمیکِ انبار
