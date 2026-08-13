---
name: advanced-search
description: >
  سیستم جستجو و فیلترِ عمل‌یار — فیلترِ چندپارامتریِ سمتِ سرور روی مراجعات، به‌همراه
  صفحه‌بندی، سورت، آمار و اسکوپِ سطحِ کاربر. هر بار که کاربر می‌خواهد فیلد/پارامتر جدیدی
  به جستجو اضافه کند، رفتارِ فیلتر یا سورت را تغییر دهد، یا همین الگو را در ماژولِ دیگری
  (حسابداری، کاربران، گزارش‌ها) پیاده کند این اسکیل را فعال کن. همچنین با «سرچ پیشرفته»،
  «فیلتر پیشرفته»، «جستجوی پیشرفته»، «صفحه‌بندی»، «مرتب‌سازی»، «advanced search».
---

# جستجو و فیلترِ عمل‌یار

> **همه‌چیز سمتِ سرور است.** کلاینت پارامتر می‌فرستد و یک بستهٔ آمادهٔ
> `{rows, total, page, pageSize, pages, sort, dir, stats}` می‌گیرد.
> هرگز کلِ داده را نگیر و در مرورگر فیلتر/سورت/صفحه‌بندی نکن — با ۱۰هزار
> مراجعه می‌شکند.

---

## ۱. مسیرِ واحد

```
ورودی‌های کاربر ─► URLSearchParams ─► GET /visits?…
                                          │
                        PatientsController.list(@CurrentUser, @Query)
                                          │
                        listVisits(f: VisitFilter, user)
                                          │
                   visitWhere(f, user) ← تنها جای منطقِ فیلتر
                                          │
                   scopedVisitWhere(user, where) ← اسکوپِ سطح
                                          │
                        enrich(v, kinds) ← فیلدهای مشتق
                                          │
                   { rows, total, page, pages, sort, dir, stats }
```

**قانون طلایی:** هر شرطِ فیلترِ جدید فقط داخلِ `visitWhere()` در
`server/src/patients/patients.service.ts` ساخته می‌شود.

---

## ۲. اسکوپِ سطحِ کاربر (object-authz — قانون ۴)

```ts
private scopedVisitWhere(user: any, where: any = {}) {
  if ((user?.level ?? 0) >= LEVEL.SUPERVISOR) return { ...where };
  return { ...where, techId: user?.id ?? -1 };   // فقط مالِ خودش
}
```

- کاربرِ **زیرِ سوپروایزر** فقط مراجعاتی را می‌بیند که به خودش منتسب است.
- `-1` عمدی است: اگر `user.id` نبود، شرط به هیچ ردیفی نمی‌خورد (fail-closed)،
  نه اینکه فیلتر حذف شود و همه‌چیز دیده شود.
- خواندنِ تکی هم باید از `assertVisitAccess(id, user)` رد شود — وگرنه کاربر با
  حدسِ `id` به رکوردِ دیگران می‌رسد.

> هر endpoint جدیدی که ردیف برمی‌گرداند **باید** از همین اسکوپ عبور کند.

---

## ۳. `VisitFilter` — پارامترهای فعلی

```ts
export type VisitFilter = {
  q?: string;                 // جستجوی آزاد
  status?: string;  kind?: string;
  surgeonId?: number; hospitalId?: number; techId?: number;
  procedureTypeId?: number; diagnosisId?: number;
  from?: Date; to?: Date;
  owing?: boolean;            // فقط آن‌هایی که بدهی دارند
  sort?: string; dir?: string;
  page?: number; pageSize?: number;
};
```

کنترلر کلِ query را می‌گیرد (`@Query() query: Record<string, string>`) و به این
شکل نرمال می‌کند؛ پس افزودنِ پارامتر نیازی به تغییرِ امضای کنترلر ندارد.

---

## ۴. افزودنِ فیلترِ جدید — سه گام

### گام ۱ — به `VisitFilter` اضافه کن
```ts
amountMin?: number; amountMax?: number;
```

### گام ۲ — نرمال‌سازی از query (رشته → عدد/تاریخ/بولین)
پارامترهای HTTP همیشه **رشته**اند. با `Number()` تبدیل کن و `NaN` را دور بریز:
```ts
const n = (v?: string) => { const x = Number(v); return Number.isFinite(x) ? x : undefined; };
```

### گام ۳ — شرط در `visitWhere()`
```ts
if (f.amountMin != null) where.amount = { ...where.amount, gte: f.amountMin };
if (f.amountMax != null) where.amount = { ...where.amount, lte: f.amountMax };
```
همهٔ شرط‌ها با **AND** ترکیب می‌شوند (رفتارِ پیش‌فرضِ `where` در پریزما).

سمتِ کلاینت فقط state + `params.set(...)` + افزودنِ کلید به وابستگیِ `useEffect`.

---

## ۵. فیلدِ مشتق قابلِ فیلتر نیست — مسیرِ مالی

«مانده» (`due`) ستونِ دیتابیس نیست، پس نه در `where` می‌آید و نه در `orderBy`.
برای سورت/فیلترِ مالی مسیرِ جداگانه‌ای هست:

1. شناسه‌های مطابقِ فیلتر با جمعِ مالی‌شان مرتب و بریده می‌شوند (`moneyOrderedIds`)
2. فقط همان صفحه از دیتابیس خوانده می‌شود
3. چون ترتیبِ `IN` تضمین‌شده نیست، ردیف‌ها دوباره به ترتیبِ شناسه‌ها چیده می‌شوند

اگر فیلدِ مشتقِ جدیدی خواستی فیلتر شود، یا همین الگو را دنبال کن یا ستونِ
محاسبه‌شده بساز — **هرگز** همهٔ ردیف‌ها را در حافظه نگیر.

---

## ۶. تله‌های واقعیِ این کد

1. **ترتیبِ ناپایدار در صفحه‌بندی** — هر `orderBy` باید با `id` تمام شود.
   بدونِ آن، دو مراجعه با تاریخِ یکسان ترتیبِ تصادفی می‌گیرند و یک رکورد در
   صفحهٔ ۱ و ۲ ظاهر (یا از هر دو غایب) می‌شود. `orderFor()` این را رعایت می‌کند.

2. **`.map(enrich)`ِ خالی ننویس.** `Array.map` ایندکس را به‌عنوانِ آرگومانِ دوم
   می‌فرستد، پس یک **عدد** به‌جای نگاشتِ نوع‌ها می‌رسد:
   ```ts
   rows.map(enrich)              // ❌ ایندکس به‌عنوان kinds
   rows.map((v) => enrich(v, kinds))  // ✅
   ```
   TypeScript این را گرفت؛ در JS بی‌صدا `undefined` می‌داد.

3. **`total` را از طولِ صفحه حساب نکن** — جدا شمرده می‌شود.

4. **`pageSize` را clamp کن** (`clamp(f.pageSize ?? DEFAULT, 1, MAX)`) وگرنه
   `?pageSize=999999` کلِ جدول را می‌کشد.

5. **debounce فقط برای تایپ** — چیپ/دراپ‌داون باید فوری اعمال شود.

---

## ۷. تأیید پس از تغییر

```bash
npm run build && cd server && npm run build      # هر دو سمت سبز (قانون ۱۲)
grep -n "\.filter(" src/app/Dashboard.jsx        # نباید فیلترِ کاربر باشد
```

چک‌لیستِ دستی:
- [ ] فیلترها با هم AND می‌شوند
- [ ] صفحه‌بندی پایدار است (رکوردِ تکراری بین صفحه‌ها نیست)
- [ ] سورتِ مالی درست کار می‌کند
- [ ] `stats` با فیلترِ فعال هم‌خوان است (نه کلِ جدول)
- [ ] کاربرِ زیرِ سوپروایزر فقط مراجعاتِ خودش را می‌بیند
- [ ] کاربرِ بدونِ مجوز ۴۰۳ می‌گیرد
- [ ] تستِ e2e سناریوی فیلترِ جدید
