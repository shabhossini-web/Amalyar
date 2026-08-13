---
name: advanced-search
description: >
  سیستم جستجو و فیلترِ عمل‌یار — سرچِ زندهٔ سمتِ سرور روی مراجعات، به‌همراه الگوی افزودنِ
  فیلترِ تازه. هر بار که کاربر می‌خواهد فیلد/پارامتر جدیدی به جستجو اضافه کند، رفتارِ فیلتر
  را تغییر دهد، یا همین الگو را در صفحه/ماژولِ دیگری (گزارش‌ها، کاربران، هزینه‌ها) پیاده کند
  این اسکیل را فعال کن. همچنین با «سرچ پیشرفته»، «فیلتر پیشرفته»، «جستجوی پیشرفته»،
  «advanced search» یا «پاپ‌آپ سرچ».
---

# جستجو و فیلترِ عمل‌یار

> **تفاوتِ بنیادی با ملک‌طب:** آن‌جا فیلتر سمتِ کلاینت روی آرایهٔ کاملِ بیماران بود.
> این‌جا **فیلتر سمتِ سرور** است — کلاینت فقط پارامتر می‌فرستد و لیستِ آمادهٔ
> غنی‌شده می‌گیرد. هیچ‌وقت کلِ داده را نگیر و در مرورگر فیلتر نکن.

---

## ۱. معماری — یک مسیرِ واحد

```
ورودی سرچ (q)  ─┐
چیپِ وضعیت (status) ─┼─►  URLSearchParams  ─►  GET /visits?q=&status=
فیلترهای بعدی      ─┘                                  │
                                                       ▼
                                   PatientsService.listVisits()  ← منبعِ حقیقتِ فیلتر
                                                       │
                                                enrich(row)  ← فیلدهای مشتق
                                                       │
                                                setVisits(rows)  ─►  render
```

**قانون طلایی:** هر شرطِ فیلترِ جدید فقط داخلِ `listVisits()` در
`server/src/patients/patients.service.ts` ساخته می‌شود. کلاینت هیچ‌وقت
`rows.filter(...)` برای فیلترِ کاربر نمی‌زند.

> استثنا: `stats` در `Dashboard.jsx` که روی همان نتیجهٔ فیلترشده شمارش می‌کند
> (`rows.filter(v => v.opStatus === 'pending').length`) — این تجمیعِ نمایشی است، نه فیلتر.

---

## ۲. نقشهٔ کد

| جزء | محل | نقش |
|---|---|---|
| state سرچ | `Dashboard.jsx` → `q`, `status` | ورودی‌های کاربر |
| debounce | `useEffect` با `setTimeout(…, q ? 300 : 0)` | ۳۰۰ms هنگام تایپ، فوری برای چیپ |
| فراخوان | `load(query, st)` | `URLSearchParams` → `api('/visits?…')` |
| endpoint | `patients.controller.ts` → `@Get('visits')` | `@Query('q')`, `@Query('status')` |
| فیلترِ اصلی | `patients.service.ts` → `listVisits()` | ساختِ `where` پریزما |
| غنی‌سازی | `enrich(v)` همان فایل | `code`, `fullName`, `due` … |
| گارد | `@UseGuards(JwtAuthGuard, FeatureGuard) @Feature('dashboard')` | سطح از DB |

**رفتارِ ۴۰۳:** اگر `FeatureGuard` رد کند، `load` وضعیتِ `denied` را ست می‌کند و
پیامِ «دسترسیِ کافی برای این بخش ندارید» نمایش داده می‌شود — نه توست خطا.

---

## ۳. فیلدهای فعلی

| پارامتر | تطبیق در سرور |
|---|---|
| `q` | `OR` روی `patient.firstName` / `lastName` / `code` / `phone` / `surgeonName` / `hospitalName` — همه `contains` و `mode:'insensitive'` (جز `phone`) |
| `status` | برابری با `opStatus` ∈ `pending` / `done` / `cancelled`؛ مقدار `all` یعنی بدونِ شرط |

---

## ۴. افزودنِ فیلترِ جدید — چهار جای هماهنگ

مثال: فیلترِ بازهٔ مبلغ (`amountMin` / `amountMax`).

### گام ۱ — کنترلر
```ts
@Get('visits')
list(
  @Query('q') q?: string,
  @Query('status') status?: string,
  @Query('amountMin') amountMin?: string,
  @Query('amountMax') amountMax?: string,
) {
  return this.patients.listVisits(q, status, { amountMin, amountMax });
}
```
> پارامترهای query همیشه **رشته**اند — با `Number()` تبدیل کن و `NaN` را دور بریز.

### گام ۲ — سرویس (تنها جای منطقِ فیلتر)
```ts
const min = Number(f?.amountMin);
const max = Number(f?.amountMax);
if (Number.isFinite(min)) where.amount = { ...where.amount, gte: min };
if (Number.isFinite(max)) where.amount = { ...where.amount, lte: max };
```
همهٔ شرط‌ها با **AND** ترکیب می‌شوند (رفتارِ پیش‌فرضِ `where` در پریزما).

### گام ۳ — کلاینت: state + پارامتر
```jsx
const [amountMin, setAmountMin] = useState('');
// داخلِ load():
if (amountMin) params.set('amountMin', amountMin);
// وابستگیِ useEffect را اضافه کن:
useEffect(() => { … }, [q, status, amountMin, load]);
```

### گام ۴ — کنترلِ UI
ورودیِ مبلغ الگوی `MoneyInput` را دارد: تومان، گروه‌بندیِ سه‌رقمی **در blur**،
«به‌حروفِ» زنده زیرش (`lib/money.js`). فیلترِ تاریخ ورودیِ متنیِ «۱۴۰۵/۰۴/۲۸»
با دکمهٔ «امروز» است و قبل از ارسال با `jStrToIso` به ISO تبدیل می‌شود.

> اگر فیلد مشتق است (`due`)، در پریزما مستقیم قابل فیلتر نیست چون در DB ستون ندارد.
> یا شرط را با ریاضیِ معادلِ ستون‌های واقعی بنویس، یا ستونِ محاسبه‌شده اضافه کن —
> **هرگز** کلِ رکوردها را نگیر و در JS فیلتر نکن.

---

## ۵. اگر پاپ‌آپِ چندپارامتری ساختی

- مودال با الگوی `db-overlay` / `db-sheet` (bottom-sheet در موبایل، وسط‌چین در دسکتاپ).
- **مودال باید در ریشهٔ درختِ صفحه رندر شود**، نه داخلِ کارتی که `backdrop-filter`
  یا `transform` دارد — وگرنه `position:fixed` نسبت به آن کانتینر محاسبه می‌شود و
  بک‌دراپ فقط بخشی از صفحه را می‌گیرد. (`.glass` هر دو را دارد، پس این تله واقعی است.)
- بستن با کلیک روی بک‌دراپ **و** کلیدِ `Escape`.
- بجِ «تعداد فیلترِ فعال» روی دکمهٔ باز کردن.
- «پاک کردن همه» همهٔ stateها را ریست و یک بار `load` می‌زند.
- هر ورودی فقط state را ست می‌کند؛ منطق در `useEffect`ِ واحدِ debounce می‌ماند —
  پراکنده‌اش نکن.

---

## ۶. تأیید پس از تغییر

```bash
npm run build && cd server && npm run build     # هر دو سمت سبز (قانون ۱۲)
grep -rn "\.filter(" src/app/Dashboard.jsx      # نباید فیلترِ کاربر باشد، فقط تجمیعِ stats
```

چک‌لیستِ دستی:
- [ ] تایپ در سرچ → بعد از ~۳۰۰ms یک درخواست (نه یکی به‌ازای هر حرف)
- [ ] چیپِ وضعیت فوری اعمال می‌شود
- [ ] فیلترها با هم AND می‌شوند
- [ ] خالی‌بودنِ نتیجه پیامِ درست می‌دهد («موردی مطابقِ جستجو پیدا نشد» در برابر «هنوز مراجعه‌ای ثبت نشده»)
- [ ] کاربرِ کم‌سطح ۴۰۳ می‌گیرد و پیامِ `denied` می‌بیند
- [ ] تستِ e2e سناریوی فیلترِ جدید (الگوی §۵ اسکیلِ `amalyar-standard`)
