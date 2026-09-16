# لِینِ ج — لایهٔ کار، پوسته، امروز — مالک: `claude-fable`

> فقط `claude-fable` این فایل را ویرایش می‌کند. وضعیت: ⬜ نشده · 🟡 در دست · ✅ مرج‌شده (با هش) · ⛔ مسدود.

| ترتیب | بسته | وضعیت | شاخه | کامیتِ مرج | یادداشت |
|---|---|---|---|---|---|
| ۰ | سندِ بازبینی + `docs/plan/` (این پوشه) | ✅ | `claude/quirky-volta-uyuznl` | PR #11 (`6b76cd1`) | روی `main` است |
| ۱ | W2.1 WorkItem + DomainEvent + `/work` + permissionها | ✅ | `claude/quirky-volta-uyuznl` | PR #12 (`8c3f234`) | `CONTRACTS.md` §۱–۲ · e2e: `scripts/e2e/w2-1-work-layer.mjs` (۲۲/۲۲) |
| ۲ | W2.4 پوستهٔ سراسری + جستجوی بیمار + زنگِ اعلان + صفحهٔ «کارهای من» | 🟡 | `claude/quirky-volta-uyuznl` | PR باز | `CONTRACTS.md` §۱۰ · e2e: `scripts/e2e/w2-4-shell.mjs` (۱۷/۱۷، دو بار) |
| ۳ | W2.2 تولیدکننده‌های کار (emit در سرویس‌ها) | ⬜ | `claude/w2-2-work-producers` | | یک خط `emit` در سرویس‌های لِینِ الف، با اعلام |
| ۴ | W2.3 صفحهٔ «امروز» + خلاصهٔ صبح | ⬜ | `claude/w2-3-today` | | `DECISIONS.md` #۲ |
| ۵ | W2.5 نمای استثنای مدیر | ⬜ | `claude/w2-5-exceptions` | | |
| ۶ | W3.1 پروندهٔ زنده | ⬜ | `claude/w3-1-live-record` | | پس از W1.2 |
| ۷ | W3.2 فضای کارِ ویزیت (اول استخراجِ `VisitForm`) | ⬜ | `claude/w3-2-visit-workspace` | | |
| ۸ | W3.3 میزِ پذیرشِ روز | ⬜ | `claude/w3-3-front-desk` | | پس از W1.5 |
| ۹ | W3.8 یکی‌کردنِ منبعِ ساعت/کارشناس + پیشنهادِ جراح/عمل در تأیید | ⬜ | `claude/w3-8-single-source` | | |
| بعد | W4.1 / W4.2 مسیرِ درمان · W5.1–W5.4 دستیار درونِ کارها | ⬜ | | | |

## سؤال از مالک
- (خالی)

## یادداشت برای لِین‌های دیگر
- W2.1 اول از همه لند می‌شود تا W1.2 (لِینِ الف) بتواند `WorkService.upsert` را صدا بزند.
