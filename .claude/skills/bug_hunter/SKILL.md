---
name: bug_hunter
description: >
  اسکن فایل‌های پروژه عمل‌یار برای پیدا کردن باگ‌های رایج. هر بار که کاربر از «باگ»، «مشکل»،
  «کار نمی‌کنه»، «بررسی کن»، «چک کن»، «debug» یا «bug_hunter» صحبت می‌کند این اسکیل را
  فعال کن. با `/bug_hunter` یا `/bug_hunter <filename>` فراخوانی می‌شود.
  برای بررسی diff آخرین تغییرات، فایل خاص، یا کل پروژه استفاده کن.
---

# Bug Hunter — عمل‌یار

اسکنر باگ مخصوص عمل‌یار. استک پروژه:
- **فرانت:** React 18 + Vite + framer-motion + react-router (`src/`)
- **بک‌اند:** NestJS 10 + Prisma + PostgreSQL 18 (`server/src/`)
- **مالتی‌تننت:** Database-per-Tenant — tenant فقط از **Host** resolve می‌شود
- **RTL فارسی**، تک‌تمِ تاریک، PWA با `public/sw.js`

---

## نحوه اجرا

**بدون آرگومان** — اسکن `git diff HEAD~1`:
```
/bug_hunter
```

**با فایل مشخص:**
```
/bug_hunter src/app/Dashboard.jsx
/bug_hunter server/src/patients/patients.service.ts
```

---

## مراحل اجرا

### ۱. تعیین scope

- فایل مشخص شده → همان را بخوان
- بدونِ آرگومان → `git diff HEAD~1 --name-only` → فایل‌های تغییرکرده را بخوان
- خالی بود → `git diff --cached --name-only` و بعد `git status`

### ۲. اسکن

#### 🔴 Critical

**دسترسیِ هاردکد (نقضِ قانون ۳):**
```ts
// ❌ سطح در کد
if (user.level >= 4) return this.reports();

// ✅ دو لایهٔ مکمل، هر دو از DB
@Controller('reports')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('reports')                       // ماژول روشن/خاموش (پلن)
export class ReportsController {
  @Get()
  @RequirePermissions('reports.read')     // عملیاتِ ریز
  list() {}
}
```
همچنین در UI: `Launcher.jsx` باید از `GET /features` گیت شود؛ `min` فقط fallback است.

**گاردِ ناقص — `@Feature` هست ولی `PermissionGuard` نیست:**
```ts
// ❌ ماژول گیت شده ولی حذف و خواندن یک سطح دارند
@UseGuards(JwtAuthGuard, FeatureGuard)
@Feature('dashboard')

// ✅
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
```
هر متدِ نوشتاری باید `@RequirePermissions('<entity>.<action>')` داشته باشد
(`patients.create`, `patients.delete`, `visits.times`…). متدِ بدونِ آن یعنی
هرکسی که ماژول را می‌بیند می‌تواند بنویسد.

**نبودِ اسکوپِ سطح — object-authz (نقضِ قانون ۴):**
```ts
// ❌ کارشناس مراجعاتِ همه را می‌بیند
return this.prisma.visit.findMany({ where });

// ✅ زیرِ سوپروایزر فقط مالِ خودش
return this.prisma.visit.findMany({ where: this.scopedVisitWhere(user, where) });
```
و برای خواندنِ تکی `assertVisitAccess(id, user)` — وگرنه با حدسِ `id`
رکوردِ دیگران خوانده می‌شود. هر endpoint جدیدی که ردیف برمی‌گرداند باید اسکوپ شود.

**نشتِ مالتی‌تننت (نقضِ قانون ۱۸):**
```ts
// ❌ tenant از ورودیِ کاربر
const tenant = req.headers['x-tenant'] ?? req.body.tenantId;

// ✅ فقط از Host دقیق، در middleware
```
پرچمِ خطر: هر جایی که `tenantId`/`tid` از header، body یا query خوانده شود؛
یا کوئری‌ای که خارج از tenant-context به Prisma می‌رود.

**فیلدِ ریالی (نقضِ قانون ۱۳):**
```ts
// ❌ هیچ فیلدِ ریالی ساخته نشود — درسِ باگ‌های ملک‌طب
amountRial: v.amount * 10,

// ✅ همه‌جا تومانِ صحیح
amount: v.amount, // تومان
```
پرچمِ خطر: هر `* 10`، `/ 10`، یا نامی که `rial`/`ریال` دارد.

**فرمولِ مشتق در کلاینت (نقضِ قانون ۱۵):**
```jsx
// ❌ محاسبه در render
<b>{v.amount - v.paid}</b>

// ✅ فیلدِ آماده از enrich() سرور
<b>{fmtMoney(v.due)}</b>
```
معیار: هر عملگرِ حسابی روی فیلدهای API داخلِ JSX یک Critical است.

**تبدیلِ تاریخِ دست‌ساز (نقضِ قانون ۱۴):**
```js
// ❌ تبدیل دستی
const jy = gy - 621;

// ✅ فقط از lib/jalali.js
import { jStrToIso, isoToJStr, todayJStr } from '../lib/jalali';
```

**Prisma — نبودِ بررسیِ وجود:**
```ts
// ❌ null dereference
const v = await this.prisma.visit.findUnique({ where: { id } });
return enrich(v);

// ✅
if (!v) throw new NotFoundException('مراجعه پیدا نشد');
```

**کشِ `/api` در Service Worker (نقضِ قانون ۱۱):**
```js
// ❌ در public/sw.js
if (url.pathname.startsWith('/api')) return cache.match(req);
// ✅ /api هرگز کش نمی‌شود
```

#### 🟡 Warning

**`useEffect` بدونِ cleanup:**
```jsx
// ❌ نشتِ تایمر / رقابتِ درخواست
useEffect(() => { setTimeout(() => setToast(''), 2200); }, [toast]);

// ✅
useEffect(() => {
  if (!toast) return undefined;
  const t = setTimeout(() => setToast(''), 2200);
  return () => clearTimeout(t);
}, [toast]);
```

**`await` بدونِ try/catch در هندلرِ UI:**
```jsx
// ❌ خطا بی‌صدا می‌ماند
const onSave = async () => { await api('/visits', { method: 'POST', body }); };

// ✅ + همیشه finally برای busy
try { … } catch (e) { setToast(e.message); } finally { setBusy(false); }
```

**`.map(f)`ِ خالی روی تابعِ چندآرگومانی:**
```ts
// ❌ Array.map ایندکس را آرگومانِ دوم می‌فرستد → عدد به‌جای نگاشت
rows.map(enrich)
// ✅
rows.map((v) => enrich(v, kinds))
```
باگِ واقعیِ همین ریپو. در TS گرفته شد، در JS بی‌صدا `undefined` می‌داد.

**صفحه‌بندیِ ناپایدار:**
```ts
// ❌ دو ردیفِ هم‌تاریخ ترتیبِ تصادفی می‌گیرند → رکورد در صفحهٔ ۱ و ۲ تکرار می‌شود
orderBy: [{ opDate: 'desc' }]
// ✅ همیشه با id تمام شود
orderBy: [{ opDate: 'desc' }, { id: 'desc' }]
```

**`pageSize` بدونِ clamp** — `?pageSize=999999` کلِ جدول را می‌کشد.

**آرایهٔ وابستگیِ ناقص یا `key` با ایندکس:**
```jsx
// ❌ key={i} روی لیستی که مرتب/فیلتر می‌شود
{rows.map((r, i) => <Card key={i} … />)}
// ✅ key={r.id}
```

**پیامِ خطای غیرفارسی (نقضِ قانون ۸):**
```ts
// ❌ @IsString({ message: 'name must be a string' })
// ✅ @IsString({ message: 'نام باید متن باشد' })
```

**دسترس‌پذیری/طراحی:**
- کارتِ تعاملی بدونِ `glass-glow` یا بدونِ `focus-visible`
- کامپوننتِ انیمیشن‌دار بدونِ بلوکِ `prefers-reduced-motion`
- ایموجی/گلیفِ متنی به‌جای آیکونِ SVG (نقضِ قانون ۷)
- `border-inline-*` برای رسمِ شکل در RTL (نقضِ قانون ۹ — تیکِ قرینه)
- عدد/کد بدونِ `dir="ltr"`

**توکن/سشن:**
- خواندنِ توکن از جایی جز `lib/api.js` (`getToken/setToken`)
- مسیرِ ورودِ جدیدی که از `adopt()` در `auth.jsx` رد نمی‌شود (چندحسابی می‌شکند)
- «خروج» که فقط توکن را پاک می‌کند و `logoutAccount/logoutAll` را صدا نمی‌زند

#### 🔵 Info

- `let` که هرگز reassign نمی‌شود → `const`
- `console.log` باقی‌مانده
- کلیدِ ماژولِ جدید که در `FEATURE_DEFAULTS` هست ولی در `FEATURE_FA` (Users.jsx) نیست — یا برعکس
- تغییرِ شِلِ PWA بدونِ bump شدنِ `CACHE` در `public/sw.js`
- `schema.prisma` تغییر کرده ولی پوشهٔ migration اضافه نشده
- کامپوننت/تابعِ unreachable

---

## فرمت گزارش

```
## 🔍 Bug Hunter — [نام فایل(ها)]

### 🔴 Critical (N مورد)

**[شماره]. [عنوان کوتاه]**
- فایل: `src/app/Dashboard.jsx:123`
- مشکل: توضیح مختصر
- کد مشکل‌دار:
  ```
  کد اشتباه
  ```
- راه‌حل:
  ```
  کد درست
  ```

### 🟡 Warning (N مورد)
…

### 🔵 Info (N مورد)
…

---
✅ موارد یافت‌شده: X critical، Y warning، Z info
```

---

## بررسی‌های سریعِ کمکی

```bash
# فرمولِ مشتق که به کلاینت نشت کرده
grep -rn "\.amount\s*-\s*\|\.paid\s*-\s*" src/

# ردِّ ریال (باید خالی باشد)
grep -rni "rial\|ریال" src/ server/src/

# سطحِ هاردکد
grep -rn "level\s*[><=]=\?\s*[0-9]" src/ server/src/

# کنترلرِ بدونِ گاردِ کامل
grep -rLn "PermissionGuard" server/src/*/*.controller.ts

# متدِ نوشتاری بدونِ مجوز
grep -rn -A2 "@\(Post\|Patch\|Put\|Delete\)(" server/src/*/*.controller.ts | grep -B1 -v "RequirePermissions"

# tenant از ورودیِ کاربر (باید خالی باشد)
grep -rn "headers\[.x-tenant\|body\.tenantId\|query\.tenantId" server/src/

# ایموجی در JSX
grep -rnP "[\x{1F300}-\x{1FAFF}\x{2190}-\x{21FF}\x{2700}-\x{27BF}]" src/ --include=*.jsx

# build سبزِ هر دو سمت (قانون ۱۲)
npm run build && cd server && npm run build
```

---

## نکات مهم

1. **فقط موارد واقعی** — False positive بدتر از false negative است.
2. **context-aware** — عملگرِ حسابی داخلِ `enrich()` سرور درست است؛ همان در JSX باگ است.
   `Math.round` در `lib/money.js` هم درست است.
3. **قوانینِ قفل‌شدهٔ `CLAUDE.md` را معیار بگیر** — هر نقضِ قانونِ ۱ تا ۱۶ دستِ‌کم Warning است.
4. **پس از گزارش** بپرس «کدام موارد را فیکس کنم؟» — خودکار فیکس نکن مگر کاربر بگوید.
5. اگر تغییر رفتاریِ واقعی داشت، قبل از «انجام شد» حلقهٔ تستِ e2e (§۵ اسکیلِ
   `amalyar-standard`) را ببند — قانون ۱۲ می‌گوید هیچ push ای بدونِ سبزِ کامل.
