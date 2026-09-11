# Claude handoff — Amalyar

این فایل منبع تحویل و دفتر ثبت اصلی پروژه است. هیچ secret، password، API key یا connection URL واقعی در آن ثبت نشود.

## بازبینی نوع ۱۸۱ بیمارستان و تعرفه فاکتور — 2026-09-11 (پس از 5a6492e)

- هر ۱۸۱ رکورد دارای بازبینی نوع با منبع، متولی/وابستگی، یادداشت و تاریخ شد: ۷۳ خصوصی، ۵۸ دولتی، ۲۳ عمومی غیردولتی، ۱۲ خیریه/موقوفه و ۱۵ نیروهای مسلح. ۳۰ منبع رسمی مرکز/متولی و ۱۵۱ منبع ثانویه؛ این آمار از بررسی تلفن مستقل است. ۲۰ مقدار قبلی نوع تکمیل/اصلاح شد. آمار گروه‌ها شامل پیشنهاد چهار مورد مبهم است.
- ساسان، خاتم‌الانبیا تهران، اشرفی اصفهانی تهران و دادگستری/موقوفه فاضل عراقی برای تعرفه قطعی نیازمند تأیید پروانه/قرارداد هستند. دریافت جدید آن‌ها بدون انتخاب صریح گروه انجام نمی‌شود؛ تأیید اپراتور پلتفرم نیز صریح و ممیزی‌شده است. نوع باقی ۱۷۷ رکورد بدون پرچم اختلاف ثبت است؛ منبع ثانویه، تأیید وزارت بهداشت محسوب نمی‌شود.
- محب کوثر طبق فهرست فعلی دانشگاه علوم پزشکی ایران دولتی؛ محب مهر طبق معرفی خودش خصوصی؛ عدل با وجود وابستگی قوه قضاییه طبق گزارش راه‌اندازی دارای تعرفه خصوصی. تأمین اجتماعی، دانشگاه آزاد و مراکز وابسته در گروه خود بررسی شدند. هیچ ضریب مالی، نرخ یا قانون سالانه از روی نام/وابستگی حدس زده و وارد نشد.
- migration کنترل `20260911210000_hospital_sector_review` فیلد JSON بررسی و نسخه را اضافه می‌کند. درج اولیه همراه بازبینی است؛ در نصب قبلی، به‌روزرسانی یک‌باره فقط نوع برابر seed قبلی را اصلاح می‌کند، انتخاب متفاوت اپراتور و همه تماس/نام/آدرس/وضعیت‌ها حفظ می‌شوند؛ رقابت با شرط نسخه و updatedAt کنترل شده و نتیجه ممیزی می‌شود. دیتابیس تننت migration جدید ندارد.
- کارت فهرست، منبع مالکیت و نوع فعلی تننت را نشان می‌دهد. دکمه «اعمال نوع تعرفه» برای دریافت‌های قبلی فقط با اقدام مدیر و `definitions.manage` تغییر می‌دهد؛ تکمیل فیلدهای خالی همچنان گروه مالی را عوض نمی‌کند. ضرایب اختصاصی شرکت مقدم‌اند، نبود ضریب گروه/سال خطای روشن دارد و به خصوصی برنمی‌گردد. snapshot فاکتور صادرشده و پرداخت/اقلام قبلی تغییر نمی‌کند.
- مستند کامل تمام ردیف‌ها: `docs/hospital-sector-review.md`؛ داده قابل بازبینی: `server/src/catalog/hospital-sector-review.json`. راهنما در دانش دستیار نیز به‌روز شد.
- اعتبارسنجی: بیلد فرانت و بک‌اند موفق؛ ۱۲ سناریوی دیتابیس/تعرفه و ۶ سناریوی مرورگر موفق؛ هر ۶۳ گام workflow روی نسخه ترکیبی با `5a6492e` موفق؛ هر دو بیلد و ۶ سناریوی مرورگر پس از یکپارچه‌سازی دوباره موفق؛ shadow دیتابیس کنترل بدون اختلاف. هیچ پیام واقعی یا تغییر داده تولید در تست انجام نشد؛ وضعیت Coolify جداگانه باید مشاهده شود.

## فهرست مرکزی بیمارستان‌ها — 2026-09-11 (پس از f48a427)

- پنل مرکزی: مدیریت نام، استان/شهر، تلفن، آدرس، نوع، لینک منبع، وضعیت بررسی و فعال‌بودن بیمارستان. seed دارای ۱۸۱ رکورد (۱۵۸ شهر تهران، ۲۳ دیگر شهرهای استان)، شامل ۷۰ خصوصی؛ ۶۳ اطلاعات تماس تطبیق‌شده با سایت بیمارستان و ۱۱۸ نیازمند بررسی منبع ثانویه. گاندی تا تأیید وضعیت فعالیت غیرفعال است؛ ۱۸۰ رکورد قابل دریافت‌اند.
- تعاریف پایه بیمارستان: جستجو و فیلتر فهرست مرکزی، انتخاب گروهی و دریافت مستقل در DB تننت. تطبیق نام و شهر نیازمند اتصال صریح مدیر است؛ دریافت مجدد شناسه مرکزی تکرار نمی‌سازد. نام، نوع تعرفه، یادداشت و اطلاعات غیرخالی تننت حفظ می‌شود؛ تکمیل فیلدهای خالی فقط با درخواست صریح است. اولویت تعاریف پایه و تعرفه‌های قبلی عوض نشده است.
- مدل مرکزی در control DB و اتصال اختیاری centralId/centralSnapshot/province در Hospital تننت؛ دو migration افزایشی با زمان 20260911200000. seed فقط درج اولیه/موارد جدید انجام می‌دهد و اصلاح اپراتور را در دیپلوی بعدی بازنویسی نمی‌کند. نوشتن مرکزی دارای نشست پلتفرم/CSRF/ممیزی؛ دریافت تننت دارای definitions.manage و ممیزی مستقل است.
- راهنمای استفاده و مرز پوشش به دانش دستیار سایت و `docs/hospital-directory.md` اضافه شده است. منابع هر ردیف در `server/src/catalog/hospitals.seed.json` ثبت است. تطبیق وب به معنی تماس تلفنی، تأیید زنده فعالیت یا رجیستری قطعی همه بیمارستان‌های تهران نیست. تکمیل سراسری استان‌های ایران و تطبیق رسمی مجوزها همچنان باز است.
- اعتبارسنجی: build هر دو سمت موفق؛ هر ۶۱ بررسی workflow محلی عبور کرد (شامل ۷ سناریوی واقعی DB فهرست)، ۳ سناریوی مرورگر موبایل/پنل موفق؛ shadow کنترل بدون اختلاف و shadow تننت دقیقاً برابر baseline قبلی، بدون drift جدید. تست‌ها با DB دورریختنی و رابط شبیه‌سازی‌شده، بدون پیام واقعی انجام شدند. مشاهده وضعیت واقعی Coolify در دسترس این محیط نیست؛ موفقیت محلی یا ثبت main به معنی سبزشدن آن نیست.

## حساب‌های آزمایشی با شماره مشترک — 2026-09-11 (پس از 0eeee1c)

- کاربران: سوپرادمین از حساب اصلی حالت آزمایشی را روشن می‌کند؛ در «ساخت حساب موقت» گزینه شماره مشترک و یوزرنیم یکتا شامل حرف لاتین انتخاب می‌شود. هر حساب Person، رمز و نقش مستقل دارد؛ حساب پزشک به جراح جدید همان پروفایل وصل می‌شود. شماره تماس واقعی حفظ می‌شود و پیام‌های حساب‌ها به همان شماره می‌روند. ایجاد حساب خودش هیچ پیامکی ارسال نمی‌کند.
- مهاجرت `20260911180000_test_account_phone_scopes`: همه اشخاص موجود scope اصلی می‌گیرند؛ یکتایی DB برای `(phone, phone_scope)`، scope تصادفی فقط در مسیر آزمایشی سوپرادمین. شماره اشخاص عادی همچنان یکتا است. ثبت‌نام/تحویل حساب و ورود با موبایل فقط scope اصلی را می‌خوانند؛ تست با یوزرنیم وارد می‌شود. کد ملی همچنان یکتا و اختیاری است.
- OTP آزمایشی به account ID و شماره مقید است؛ در ثبت‌نام عمومی یا حساب هم‌شماره دیگر قابل استفاده نیست. انقضای هفت‌روزه و محدودیت تلاش/ارسال حفظ شده است. حساب آزمایشی منقضی از ثبت‌نام عمومی قابل تحویل نیست؛ برای ادامه تست حساب آزمایشی تازه بسازید.
- «پایان تست» در یک تراکنش setting، حساب‌های آزمایشی فعال، نشست‌ها و ممیزی را به‌روزرسانی می‌کند. فعال‌سازی دوباره، حساب‌های قبلی را خودکار فعال نمی‌کند؛ داده‌ها پاک نمی‌شوند. ورود/نشست/صدور پس‌کی هم حالت خاموش را رد می‌کند. هیچ داده بیمار یا مالی برای تست تغییر داده نشده است.
- برچسب آزمایشی در کاربران، پروفایل و منوی چندحسابی؛ راهنمای کاربری به دانش دستیار افزوده شد. تنها مدیر اصلی می‌تواند حالت را کنترل یا حساب آزمایشی بسازد؛ حساب آزمایشی با نقش سوپرادمین هم اجازه این دو عملیات را ندارد.
- اعتبارسنجی انتشار: build هر دو سمت، ۶۰ بررسی workflow (از جمله ۹ سناریوی DB حساب آزمایشی)، ۷ مسیر موبایل و shadow diff بدون اختلاف جدید نسبت به baseline. آزمون‌ها با DB دورریختنی، پیامک stub و بدون پیام واقعی انجام می‌شوند. وضعیت واقعی Coolify جداگانه باید مشاهده شود.

## یکپارچه‌سازی عملیات شرکت — 2026-09-11 (پس از 301d529)

- فاکتور نورو اکنون انتخاب‌ها، مصرف انبار و ممیزی را در یک تراکنش ثبت می‌کند؛ خطای میانی هیچ قلم یا مصرف نیمه‌کاره باقی نمی‌گذارد. حذف قلم از صورتحساب هم تراکنشی است. برگشت کالا فقط با انتخاب صریح «مصرف نشده» انجام می‌شود. اقلام دستی و پرداخت‌های قبلی حفظ می‌شوند.
- مصرفی‌ها از انبار انتخاب می‌شوند؛ اثر «فقط فاکتور» یا «کاهش موجودی» قابل انتخاب و ذخیره در پیش‌فرض شرکت است. پیش‌فرض هویت کالا را نگه می‌دارد و لات برای هر مراجعه انتخاب می‌شود. مصرف تجمعی بر اساس دفتر حرکت است تا ذخیره یا تکرار درخواست دوباره مصرف نزند. قالب متنی قدیمی پیش‌فرض‌ها همچنان خوانده می‌شود.
- پرتال جراح دو تب بیماران/دستورها و بیلان سهم نهایی، پرداخت و مانده دارد. فیلتر شناسه جراح برای کاربر عادی قابل تحمیل نیست. شرکت نورو/ایمپلنت با مدل مطب تفکیک می‌ماند؛ مدیر برای بیلان، جراح را انتخاب می‌کند.
- دستیار از راهنمای نسخه‌بندی‌شده قابلیت‌ها، رجیستری دسترسی و AI تنظیم‌شده شرکت استفاده می‌کند؛ تشخیص نوع جستجو و واکشی محدود بیمار، بیمارستان یا کالا با کنترل دسترسی. محتوای بازیابی‌شده دستور قابل اجرا نیست و دستیار ادعای ثبت عملیات نمی‌کند.
- سوپرادمین از کاربران حساب موقت می‌سازد، رمز اولیه فقط در همان پاسخ نشان داده می‌شود و در ممیزی نیست. صاحب شماره در پروفایل OTP را تأیید می‌کند. انقضای هفت‌روزه در ورود، نشست و worker اعمال و نشست‌ها باطل می‌شوند؛ تأیید نهایی سطح یا نقش نمی‌دهد و حساب غیرفعال خودکار فعال نمی‌شود. حساب‌های قدیمی بدون مهلت، ناگهان منقضی نمی‌شوند.
- چینش روز بر اساس بیمارستان، کارشناس و ساعت حضور است؛ هر مراجعه به کارشناس همان بیمارستان متصل می‌شود. پذیرش مراجعه آزاد در پرتال کارشناس به روز/بیمارستان خدمت محدود و رقابت دو پذیرش کنترل می‌شود. جراح در تأیید نورو اجباری و کارشناس اختیاری است. انتخاب/تطبیق مطمئن بیمارستان بیمار از تعاریف پایه انجام می‌شود.
- برنامه کارشناس در پیامک و پیام‌رسان با هویت «ربات اطلاع‌رسانی» ثبت می‌شود؛ ارسال تکراری متن یکسان تکرار نمی‌سازد. حمل‌ونقل انتخاب تجهیزات و حواله برنامه‌ریزی‌شده، اتصال حواله به توقف و ابلاغ مسیر به راننده دارد. هیچ پیام واقعی در تست ارسال نشده است.
- دفتر یادآوری کانال، خطا، شناسه سرویس پیامک، پذیرش سرویس و خوانده‌شدن پیام داخلی را نشان می‌دهد. پذیرش سرویس پیامک به معنای تحویل گوشی نیست؛ اتصال گزارش تحویل اپراتور هنوز تأیید عملیاتی نشده و نباید «رسیده» ادعا شود.
- اصلاح CI برای AnimatePresence در والد واقعی NeuroInvoiceDialog و اعلان نسخه جدید فرانت بدون دورریختن فرم باز. اطلاعات قدیمی درباره مجازی‌بودن همیشگی مصرفی نورو در بخش‌های تاریخی این سند با تغییر بالا جایگزین می‌شود.

تست‌ها: ساخت فرانت/بک‌اند؛ مهاجرت کامل و shadow diff بدون اختلاف جدید؛ ۱۹ سناریوی فاکتور، ۱۶ سناریوی تفکیک مدل، ۱۱ سناریوی عملیات شرکت، ۴۴ بررسی مرورگر/چاپ فاکتور و ۶ مسیر موبایل. هر ۵۹ بررسی workflow در اجرای نهایی محلی عبور کرد. این مجموعه برای انتشار روی main آماده و آزموده شده است؛ وضعیت Coolify جداگانه باید مشاهده شود. تست‌های شرکت شامل خطای تزریق‌شده پس از تغییر فاکتور/انبار، تکرار مصرف، OTP/انقضا، دامنه بیلان، رقابت پذیرش و جستجوی بدون مجوز است.

Coolify: دسترسی مستقیم برای مشاهده این استقرار نداریم؛ موفقیت build/CI به‌تنهایی به معنی سبزشدن Coolify نیست.

## قاعده اجباری ثبت تغییرات

از تاریخ 2026-07-21 به درخواست مالک پروژه:

- بعد از هر تغییر کد، تنظیم Coolify، عملیات دیتابیس، deployment، تست یا تصمیم معماری، همین فایل در همان نوبت به‌روزرسانی شود.
- هر Agent بعدی، از جمله Claude یا Codex، باید پیش از شروع این فایل را بخواند و قبل از پایان کار وضعیت جدید، نتیجه تست و کار باقی‌مانده را ثبت کند.
- اطلاعات محرمانه فقط با نام متغیر ثبت شوند و مقدار آن‌ها هرگز وارد Git نشود.
- اگر کار شکست خورد، خطا و راه‌حل یا blocker نیز ثبت شود؛ فقط موفقیت‌ها ثبت نشوند.
- `docs/COOLIFY_STAGING_STATE.md` خلاصه وضعیت استقرار است و در تغییرات Coolify باید هم‌زمان به‌روز شود.

## GitHub

- Repo: `shabhossini-web/Amalyar`
- Main baseline: `808b2f4b677a9c627b0c01054bf1a92771a1c423`
- Working branch: `agent/security-permissions-hardening`
- Draft PR: https://github.com/shabhossini-web/Amalyar/pull/1
- آخرین commit شاخه که در CI کامل تأیید شد: `beca79650d7e9989be829affaacd690e61d252df` (`security-ci` run 274)
- آخرین commit کد بک‌اند که deployment آن در Coolify صریحاً تأیید شد: `02a86d4bf19d7144b11d92b8f9caa0e37305151e`
- commitهای بعدی ممکن است فقط مستندات باشند؛ وضعیت deploy را از Coolify کنترل کن.
- main هنوز merge نشده و نباید تا پایان تست staging و rehearsal مهاجرت merge شود.

## نام‌ها و مسیر دقیق Coolify

- Project: `Amalyar`
- Environments: `production` و `staging`
- Staging Application: `agent/security-permissions-hardening`
- Staging Database resource: `amalyar-control-staging`

تنظیم Application:

- Repo: `shabhossini-web/Amalyar`
- Branch: `agent/security-permissions-hardening`
- Build pack: Dockerfile
- Base directory: `/server`
- Dockerfile: `/Dockerfile`
- Exposed port: `3001`
- Port mapping: خالی
- Watch Paths: `server/**` (در Coolify ذخیره و تأیید شد).
- Healthcheck: `GET http://localhost:3001/api/health`
- Interval 30، timeout 10، retries 5، start period 60
- وضعیت redeploy پس از ثبت متغیرهای SMS در 2026-07-21: Running و پایدار (تأیید مالک پروژه)
- لاگ موفق: `Nest application successfully started`
- لاگ موفق: `amalyar-server ← http://0.0.0.0:3001/api`
- Health عمومی تأییدشده: `https://api-staging.amalyar.com/api/health`

دامنه‌های Backend Application پس از cutover مسیر در 2026-07-22:

- `https://api-staging.amalyar.com`
- `https://alpha-staging.amalyar.com/api`
- `https://beta-staging.amalyar.com/api`

تغییر Domains ذخیره و Backend با موفقیت Redeploy شد. تست مرورگر نشان داد:

- `https://api-staging.amalyar.com/api/health` موفق و `ok:true` بود.
- مسیرهای Alpha/Beta به Backend رسیدند اما با `Cannot GET /auth/setup-status` و 404 برگشتند؛ این خطا ثابت کرد Proxy پیشوند عمومی `/api` را قبل از تحویل به کانتینر حذف می‌کند.
- هیچ داده شخصی نمایش‌داده‌شده در اسکرین‌شات‌ها در Git ثبت نشده است.
- دامنه‌های ریشه Alpha/Beta هنوز به Frontend منتقل نشده‌اند.

اصلاح خودکار روی Branch اعمال شد:

- فایل جدید `server/src/common/api-prefix.ts` پیشوند حذف‌شده را در مرز برنامه بازیابی می‌کند.
- `server/src/main.ts` پیش از route matching، URL بدون `/api` را به قرارداد داخلی Nest برمی‌گرداند؛ URLهایی که از قبل `/api` دارند بدون تغییر می‌مانند.
- CI برای `/auth/setup-status`، query string، URL از قبل prefixed و root test اضافه کرد.
- commitهای کد: `22a2a69cf9693b2860315a0f62ad194c59a2c71c`، `d82114593dcba25370222a281ffad185165fedea` و `343384a9026669d32dd9a1b4af5c97bdf3d4e0ba`.
- GitHub Actions `security-ci` run 179 موفق شد؛ Backend سپس Redeploy شد و مالک پروژه تأیید کرد هر دو endpoint Alpha/Beta دوباره `{"needsSetup":true}` می‌دهند.

تنظیم PostgreSQL:

- Image: `postgres:18-alpine`
- Internal port: 5432
- Public access: off
- Initial DB: `amalyar_control_staging`
- Provisioning user: `amalyar_provisioner`
- Persistent storage فعال
- URL و password هرگز در Git/Chat ثبت نشود.

## Environment variables در staging

مقادیر محرمانه حذف شده‌اند:

- `CONTROL_DATABASE_URL`
- `PROVISIONING_DATABASE_URL`
- `TENANT_DATABASE_ENCRYPTION_KEY`
- `JWT_SECRET`
- `NODE_ENV=production`
- `PORT=3001`
- `CORS_ORIGINS=https://alpha-staging.amalyar.com,https://beta-staging.amalyar.com`
- `MELI_API_KEY` (مقدار محرمانه، ثبت‌شده در Coolify)
- `MELI_FROM` (مقدار محرمانه، ثبت‌شده در Coolify)

Secretها: Buildtime خاموش، Runtime روشن، Multiline خاموش، Literal روشن.

اصلاح مهم: کد از `CORS_ORIGINS` استفاده می‌کند؛ `ALLOWED_ORIGINS` اشتباه است.

در 2026-07-21 متغیرهای `MELI_API_KEY` و `MELI_FROM` از Application فعلی عمل‌یار به staging منتقل و تنظیماتشان تأیید شد. مقدارها محرمانه‌اند و در Git ثبت نشده‌اند. redeploy، ارسال واقعی SMS و نبودن OTP/شماره در log همگی تأیید شدند.

## تست SMS در staging

- تاریخ: `2026-07-21`
- Tenant تست‌شده: `alpha-staging`
- Endpoint: `POST /api/auth/signup/request-otp`
- نتیجه API: HTTP `201` با پاسخ `{"ok":true,"ttl":300}`
- هیچ شماره موبایل یا OTP در مستندات ثبت نشده است.
- دریافت پیامک روی موبایل: موفق و توسط مالک پروژه تأیید شد
- بررسی log در 2026-07-22: هیچ `STUB`، متن کد تأیید، شماره موبایل یا OTP مشاهده نشد؛ تأیید مالک پروژه

## اصلاح fail-closed پیامک

در 2026-07-22 روی شاخه `agent/security-permissions-hardening` اعمال شد:

- `server/src/sms/sms.service.ts`: نبود credential یا شکست provider در production اکنون HTTP `503` می‌دهد.
- شماره موبایل، متن پیام، OTP، پاسخ خام provider، exception خام و URL دارای API key دیگر log نمی‌شوند.
- `server/src/auth/auth.service.ts`: API در production برای پیام ارسال‌نشده پاسخ موفق نمی‌دهد.
- OTP ارسال‌نشده پاک می‌شود تا resend window کاربر را بی‌دلیل مسدود نکند.
- `.github/workflows/security-ci.yml`: تست خودکار نبود credential در production باید `503` را تأیید کند.
- commitهای کد: `b8c4b5408537543bd41b345c81f97efa030e85f9` و `02a86d4bf19d7144b11d92b8f9caa0e37305151e`
- CI run `107`: موفق (`success`)
- وضعیت Coolify پس از این تغییر: Running سبز و پایدار؛ تأیید مالک پروژه در 2026-07-22
- تست واقعی پس از اصلاح: `POST /api/auth/signup/request-otp` روی Alpha دوباره HTTP `201` و `{"ok":true,"ttl":300}` داد؛ شماره و OTP ثبت نشده‌اند.

## تصمیم onboarding کاربرپسند

در 2026-07-22 روش ساخت حساب از Terminal رد و لغو شد؛ در همان مقطع هیچ حسابی با روش دستی ساخته نشد و Tenantهای Alpha/Beta هنوز `needsSetup=true` داشتند. این وضعیت تاریخی است؛ هر دو Tenant بعداً فقط از UI راه‌اندازی شدند.

تصمیم نهایی:

- راه‌اندازی هر شرکت فقط از UI انجام شود؛ کاربر نباید command، signup token یا API payload ببیند.
- UI موجود پروژه در `src/app/Login.jsx` از قبل flow کامل setup-status، OTP، فرم پروفایل، سلفی زنده و ورود خودکار اولین Super Admin را دارد.
- فرانت باید به‌عنوان Application جدا در Coolify deploy شود.
- دامنه‌های Alpha/Beta در ریشه `/` به فرانت و مسیر `/api` همان دامنه به Backend route شوند.
- API frontend به‌صورت same-origin روی `/api` باشد تا Host واقعی شرکت به Backend برسد و tenant از header/body انتخاب نشود.
- Root دامنه Tenant مستقیماً به `/login` هدایت شود؛ اگر دیتابیس خالی باشد UI خودکار تب ثبت‌نام و پیام اولین Super Admin را نشان دهد.
- طبق مستندات رسمی Coolify، path-based routing با دامنه‌هایی مثل `https://domain/api` پشتیبانی می‌شود و مسیر خاص‌تر بر `/` اولویت دارد.

پیاده‌سازی انجام‌شده:

- `src/lib/api.js`: پیش‌فرض API از همان origin و مسیر `/api` استفاده می‌کند؛ `VITE_API_BASE` همچنان override اختیاری است.
- `src/App.jsx`: ریشه دامنه Tenant مستقیماً به `/login` می‌رود؛ marketing hostها Landing را نگه می‌دارند و `VITE_TENANT_UI` override دارد.
- `public/sw.js`: مسیر `/api` صریحاً از Service Worker خارج شد و cache به `v8` افزایش یافت.
- `Dockerfile`: Node 22 و `npm ci` با lockfile برای build تکرارپذیر.
- commitهای فرانت: `a085f8c173d6a85471fca649918e85919cf2a13e`, `4caaf8e8ab7bc96b389a0c11918b87afd0e90adf`, `703ba95524910c07d36c3f2ddd7268dfe9b772df`, `6e4976373184aef9a9f3e708d100be7ac68e573b`.
- CI run `135`: موفق.
- `nginx.conf`: اگر Backend ناسالم باشد و Coolify `/api` را به frontend fallback کند، Nginx با `503` fail-closed می‌شود و SPA HTML تحویل نمی‌دهد.
- commit fail-closed فرانت: `9ca9a9abb0084baf290e41699eb05b8473e39137`؛ CI run `141` موفق.
- Frontend Application در Coolify ساخته و تنظیمات آن در 2026-07-22 ذخیره شد؛ اولین deploy و deployهای بعدی موفق شدند و وضعیت فعلی `Running (healthy)` است.
- نام Frontend resource: `amalyar-frontend-staging`
- Build pack: `Dockerfile`
- Base Directory: `/`
- Dockerfile Location: `/Dockerfile`
- Exposed port: `80`
- Port Mapping و Network Aliases: خالی
- HTTP Basic Authentication: خاموش
- Watch Paths ذخیره‌شده: `src/**`، `public/**`، `index.html`، `package.json`، `package-lock.json`، `vite.config.js`، `Dockerfile` و `nginx.conf`
- دامنه موقت تأییدشده Frontend: `http://qryhv6hfkygfyegwc6qrffn5.62.60.214.40.sslip.io`
- اولین deploy فرانت در 2026-07-22 موفق شد؛ صفحه فارسی ورود/ثبت‌نام عمل‌یار روی دامنه موقت به‌درستی نمایش داده شد و خطای 502/503 یا JSON بک‌اند دیده نشد.
- هشدار مرورگر دامنه موقت ناشی از HTTP بودن آن است؛ دامنه‌های اصلی tenant باید با HTTPS استفاده شوند.
- Healthcheck فرانت در 2026-07-22 ذخیره و فعال شد: `GET http://localhost:80/login`، return code 200، interval 30، timeout 10، retries 5، start period 60 و response text خالی.
- دکمه Coolify اکنون `Disable Healthcheck` را نشان می‌دهد، پس فعال‌سازی تأیید شده است.
- پس از Redeploy، وضعیت Frontend به `Running (healthy)` رسید و مالک پروژه آن را تأیید کرد.
- در cutover ریشه دامنه‌ها در 2026-07-22، Frontend Domains روی `https://alpha-staging.amalyar.com`، `https://beta-staging.amalyar.com` و دامنه موقت HTTP تنظیم شد.
- Redeploy این تنظیم نیز `Running (healthy)` شد.
- smoke test اولیه Routing موفق بود: ریشه Alpha و Beta هر دو صفحه Login/Signup فرانت را نمایش دادند و `/api/auth/setup-status` در آن مقطع روی هر دو Tenant پاسخ صحیح `{"needsSetup":true}` داد.
- در آن smoke test اولیه هنوز هیچ حساب Super Admin ساخته نشده بود؛ این وضعیت تاریخی است و هر دو Tenant بعداً فقط از UI راه‌اندازی شدند.
- دامنه موقت HTTP از Frontend حذف شد؛ فقط `https://alpha-staging.amalyar.com` و `https://beta-staging.amalyar.com` باقی ماندند.
- Frontend پس از این پاک‌سازی Redeploy و `Running (healthy)` شد؛ تأیید مالک پروژه.
- onboarding اولین Super Admin آلفا از UI آغاز شد: درخواست SMS و تأیید OTP موفق بود و فرم پروفایل/نام کاربری/رمز/سلفی باز شد.
- ثبت نهایی اولین Super Admin آلفا از UI موفق شد؛ ورود خودکار انجام شد و داشبورد `/app` روی Host آلفا به‌درستی نمایش داده شد.
- شماره، OTP، نام، رمز، چهره و سایر اطلاعات شخصی عمداً در Git/مستندات ثبت نشده‌اند.
- `/api/auth/setup-status` آلفا پس از bootstrap به‌صورت مستقل تست شد و `{"needsSetup":false}` تأیید شد.
- اولین Super Admin بتا نیز فقط از UI ساخته شد؛ ورود خودکار موفق بود و داشبورد `/app` روی Host بتا نمایش داده شد.
- هیچ شماره، OTP، نام، رمز، تصویر یا داده شخصی از داشبورد در Git ثبت نشده است.
- smoke بصری نشان داد داشبوردهای Alpha/Beta داده‌های tenant-scoped متفاوت نمایش می‌دهند؛ این جایگزین تست رسمی cross-tenant token نیست.
- `/api/auth/setup-status` بتا پس از bootstrap به‌صورت مستقل تست شد و `{"needsSetup":false}` تأیید شد.
- وضعیت جاری onboarding: Alpha و Beta هر دو فقط از UI راه‌اندازی شده‌اند، هر دو داشبورد `/app` را نمایش می‌دهند و هر دو `needsSetup=false` هستند.
- Git Source پیش از اولین deploy تأیید شد: source=`amalyar-git`، repo=`shabhossini-web/Amalyar` و branch=`agent/security-permissions-hardening`.

## تصمیم Platform Admin و provisioning خودکار

در 2026-07-22 مالک پروژه ورود پیامکی Platform Admin را تأیید کرد.

معماری مصوب:

- Platform Admin از حساب و JWT شرکت‌ها کاملاً جدا است.
- ورود با OTP فقط برای شماره‌های allowlist شده در متغیر Coolify انجام می‌شود؛ هیچ شماره‌ای وارد کد یا Git نمی‌شود.
- session با token تصادفیِ hash‌شده در Control DB، کوکی `HttpOnly` کوتاه‌عمر و CSRF جدا محافظت می‌شود.
- OTP، session و درخواست‌ها rate limit و Audit می‌شوند؛ مقدار OTP، شماره، token و secret log نمی‌شود.
- API اصلی credential دارای `CREATEDB/CREATEROLE` نگه نمی‌دارد.
- UI یک `ProvisioningJob` در Control DB می‌سازد و وضعیت آن را نمایش می‌دهد.
- Worker جداگانه job را claim می‌کند، database/role مستقل می‌سازد، migration را اجرا می‌کند و نتیجه را در job ثبت می‌کند.
- Platform UI روی دامنه مدیریتی جدا deploy می‌شود؛ دامنه و Coolify resource پس از سبزشدن CI تنظیم خواهند شد.

## معماری Database-per-Tenant

تصمیم تأییدشده: هر شرکت PostgreSQL database مستقل دارد.

Control DB فقط tenant metadata، hostname و database URL رمزنگاری‌شده را نگه می‌دارد. بیمار، ویزیت، حساب و session در Control DB نیست.

فایل‌های اصلی:

- `server/prisma/control/schema.prisma`
- `server/prisma/control/migrations/**`
- `server/src/tenant/control-prisma.service.ts`
- `server/src/tenant/tenant-context.ts`
- `server/src/tenant/tenant.middleware.ts`
- `server/src/tenant/tenant-registry.service.ts`
- `server/src/tenant/tenant-crypto.ts`
- `server/src/tenant/tenant.module.ts`
- `server/src/prisma/prisma.service.ts`

رفتار:

1. tenant فقط از Host دقیق ثبت‌شده resolve می‌شود.
2. tenant ID/slug/database URL از header یا body کاربر پذیرفته نمی‌شود.
3. tenant باید active باشد.
4. AsyncLocalStorage context درخواست را نگه می‌دارد.
5. Prisma به database همان tenant route می‌شود.
6. JWT شامل `tid` است؛ توکن یک شرکت روی hostname شرکت دیگر رد می‌شود.
7. connection URL با AES-256-GCM و `TENANT_DATABASE_ENCRYPTION_KEY` رمزنگاری می‌شود.

## Provisioning و migration fleet

فایل‌ها:

- `server/src/scripts/provision-tenant.ts`
- `server/src/scripts/migrate-tenants.ts`

دستورات runtime از فایل‌های compiled اجرا می‌شوند:

```bash
npm run tenant:provision -- SLUG "NAME" HOSTNAME
npm run tenants:migrate
npm run tenants:migrate -- --apply
```

Provisioning برای هر شرکت role و database مستقل می‌سازد، migration را اجرا می‌کند، URL را رمزنگاری می‌کند و فقط پس از موفقیت tenant را active می‌کند. rollback فقط منابع ساخته‌شده همان اجرای اعتبارسنجی‌شده را حذف می‌کند.

Fleet migration پیش‌فرض dry-run است، برای اجرا `--apply` لازم دارد، sequential است و با اولین خطا متوقف می‌شود.

### ⚠️ migration شرکت‌ها خودکار است (از ۱۴۰۵/۰۵/۰۷)

اجرای دستیِ بالا دیگر **لازم نیست**؛ فقط برای مواقعی می‌ماند که می‌خواهید با
بکاپِ تازه و به‌صورت کنترل‌شده مهاجرت کنید.

API هنگام بالا آمدن و **پیش از `listen`** همهٔ شرکت‌های فعال را بررسی و
عقب‌مانده‌ها را مهاجرت می‌کند (`TenantMigratorService`). چرا: مرحلهٔ دستی یک بار
فراموش شد و هیچ خطای آشکاری نداشت — فقط جدول‌های تازه غایب بودند، بعضی
endpointها ۵۰۰ می‌دادند و صفحه‌ها ناقص دیده می‌شدند.

- قفلِ مشورتیِ Postgres روی دیتابیسِ مرکزی، تا در دیپلویِ چرخشی دو نمونه همزمان
  مهاجرت نکنند.
- برخلافِ ابزارِ دستی با اولین خطا متوقف نمی‌شود؛ شرکتِ خراب ثبت می‌شود و
  درخواست‌هایش ۵۰۳ با پیامِ روشن می‌گیرند (نه ۵۰۰های پراکنده).
- `GET /api/health` → `{ok, migrations: {tenants, upToDate, failed, unknown}}`
  بی‌نام و بدونِ احراز هویت؛ `ok=false` یعنی شرکتی عقب مانده.
- `GET /api/platform/migrations` → جزئیاتِ نام‌دار، پشتِ نشستِ پلتفرم.
- خاموش‌کردن: `AUTO_MIGRATE_TENANTS=0`.

اگر migrationی وسطِ کار شکست بخورد، Prisma آن را failed علامت می‌زند و
migrationهای بعدی اعمال نمی‌شوند تا دستی `prisma migrate resolve` بزنید — در آن
حالت همان شرکت ۵۰۳ می‌گیرد و `/health` قرمز است.

ریسک باقی‌مانده: `PROVISIONING_DATABASE_URL` اکنون داخل کانتینر دائمی API است. قبل از production آن را به یک job کوتاه‌عمر Coolify منتقل کن تا API credential دارای CREATEDB/CREATEROLE نداشته باشد.

## Tenantهای staging ساخته‌شده

Alpha:

- Slug: `alpha-staging`
- Host: `alpha-staging.amalyar.com`
- DB: `amalyar_alpha_staging`
- Role: `amalyar_alpha_staging_app`
- Status: active
- `/api/auth/setup-status` پس از bootstrap پاسخ `{"needsSetup":false}` داده است.

Beta:

- Slug: `beta-staging`
- Host: `beta-staging.amalyar.com`
- DB: `amalyar_beta_staging`
- Role: `amalyar_beta_staging_app`
- Status: active
- `/api/auth/setup-status` پس از bootstrap پاسخ `{"needsSetup":false}` داده است.

هر دو فرمان provisioning قبلاً موفق اجرا شده‌اند؛ دوباره اجرا نکن.

## امنیت و مجوزهای پیاده‌شده

مجوزهای ریزدانه:

- `patients.read`: level 2
- `patients.read_all`: 4
- `patients.create`: 3
- `patients.update`: 4
- `patients.status`: 4
- `patients.delete`: 6
- `definitions.read`: 2
- `definitions.manage`: 5
- `users.manage`: 6

فایل‌ها: `permission.decorator.ts` و `permission.guard.ts`. Permissionها در DB هر tenant هستند. Superadmin bypass دارد.

Object authorization: کاربر زیر supervisor فقط بیمار/ویزیت منتسب به `techId` خودش را می‌بیند. کنترل روی object انجام می‌شود، نه فقط endpoint.

Auth hardening:

- JWT production حداقل 32 کاراکتر و fail-closed
- JWT متصل به tenant ID
- bcrypt cost 12
- تغییر password همه sessionها را revoke می‌کند
- rate limit برای OTP/login
- dev OTP فقط با `NODE_ENV=test` در response برمی‌گردد
- bootstrap اولین superadmin با PostgreSQL advisory lock سریال شده است.

HTTP:

- CORS صریح و fail-closed
- nosniff، DENY frame، no-referrer، Permissions-Policy، COOP و HSTS production

Rate limiter فعلی in-memory است؛ قبل از چند replica باید Redis-backed شود.

## Data integrity و Audit

Schema tenant اضافه‌شده:

- `Permission`
- `AuditEvent`
- soft delete بیمار: `deletedAt`، `deletedById`، `deleteReason`
- `@@unique([patientId, seq])` برای Visit

رفتار:

- کد موقت مشترک `AM-TMP` با UUID جایگزین شد.
- حذف آخرین ویزیت بیمار را soft-delete می‌کند.
- mutationهای حساس بیمار audit می‌شوند.
- فایل‌ها: `server/src/audit/**`
- migration: `server/prisma/migrations/20260721090000_security_permissions/migration.sql`

Follow-up: برای ساخت هم‌زمان visit، unique constraint مانع duplicate می‌شود اما بهتر است retry محدود یا transaction سریال‌پذیر اضافه شود.

## خطاهای Coolify که حل شدند

1. `Cannot find module '../generated/control'`
   - generated Control Prisma client در Docker runtime کپی شد.
   - CI وجود artifact را بررسی می‌کند.

2. `Tenant context is not available for this request`
   - Nest propertyهایی مثل `then` را probe می‌کرد.
   - Proxy اکنون فقط model/operation واقعی Prisma را route می‌کند.
   - CI startup بدون tenant context را تست می‌کند.

3. `CORS_ORIGINS در production الزامی است`
   - متغیر Coolify از `ALLOWED_ORIGINS` به `CORS_ORIGINS` اصلاح شد.

## CI

`.github/workflows/security-ci.yml` این موارد را کنترل می‌کند:

- frontend install/build
- backend install/build
- validate tenant schema
- validate Control schema
- generated Control client artifact
- Prisma provider startup بدون tenant request
- مرز JWT: توکن دارای `tid` شرکت دیگر قبل از session lookup با 401 رد می‌شود.
- مرز Prisma: Tenantهای متفاوت client/database route جدا دارند، Tenant یکسان client خودش را reuse می‌کند و بدون context دسترسی fail-closed است.

تست `server/scripts/verify-tenant-isolation.js` در commit `9f27d486e3d1a342d66e05ca056136ce819ec942` اضافه و در workflow با commit `3c915d8b753fccc4894bff9712a238c35652b957` اجباری شد. GitHub Actions `security-ci` run 226 موفق شد. این تست قطعی سطح کد/CI است.
- تست زنده جداسازی داده، مرحله اول، در 2026-07-22 موفق شد: یک رکورد کاملاً ساختگی در Alpha ساخته شد و جست‌وجوی آن در Beta هیچ نتیجه‌ای نداد.
- هیچ مقدار رکورد، نام، شناسه یا داده شخصی در Git ثبت نشده است.
- تست زنده جداسازی داده، مرحله دوم، نیز موفق شد: رکورد کاملاً ساختگی Beta در Alpha پیدا نشد.
- نتیجه نهایی تست داده: جداسازی زنده در هر دو جهت Alpha→Beta و Beta→Alpha پاس شد؛ هیچ مقدار رکورد یا داده شخصی در Git ثبت نشده است.
- پس از تست، هر دو رکورد کاملاً ساختگی از Tenant مربوط به خودشان حذف شدند؛ staging از داده آزمایشی این تست پاک‌سازی شد.
- تست زنده cross-tenant token هنوز باقی مانده و باید به‌صورت خودکار اجرا شود، نه با کپی یا دست‌کاری دستی توکن توسط کاربر.

## پیاده‌سازی Platform Admin و provisioning خودکار — 2026-07-22

معماری تأییدشده اکنون روی شاخه پیاده‌سازی شده و هنوز برای staging در Coolify فعال نشده است:

- مدل‌های Control DB: `PlatformOtp`، `PlatformSession`، `ProvisioningJob` و `PlatformAuditEvent`.
- migration کنترل: `server/prisma/control/migrations/20260722213000_platform_admin_provisioning/migration.sql`.
- API مستقل Platform Admin در `server/src/platform/**` با OTP allowlist، session کوتاه HttpOnly، CSRF جدا، rate limit و audit بدون ثبت شماره/OTP/token.
- endpointهای مدیریتی زیر `/api/platform/**` قرار دارند و وقتی `PLATFORM_ADMIN_ENABLED` فعال نباشد، fail-closed و غیرقابل استفاده‌اند.
- فرانت مدیریتی موبایل‌پسند در `src/app/PlatformAdmin.jsx` و route `/platform-admin` پیاده‌سازی شد.
- UI فقط job می‌سازد و status را poll می‌کند؛ credential ساخت دیتابیس در Backend API نگهداری نمی‌شود.
- Worker در `server/src/scripts/provisioning-worker.ts` job را claim می‌کند، role/database اختصاصی می‌سازد، migration tenant را اجرا می‌کند و ثبت tenant + موفقیت job + audit را در یک transaction کنترل انجام می‌دهد.
- failure معمولی با error code امن ثبت و role/database ساخته‌شده در همان invocation rollback می‌شود.
- image مستقل و بدون پورت عمومی Worker در `server/Dockerfile.worker` اضافه شد؛ command ثابت آن `node dist/scripts/provisioning-worker.js` است.
- script محلی/runtime: `npm run provisioning:worker`.
- فایل خالص تنظیمات امنیتی `server/src/platform/platform.config.ts` از ماژول runtime جدا شد تا fail-closed بودن بدون نیاز به Prisma Client تست شود.
- CI run 266 به‌علت import کل `platform.module` و نبود runtime-generated Control client در آن مرحله شکست خورد؛ این شکست مربوط به harness تست بود، نه منطق امنیتی.
- اصلاح CI با commitهای `78fec7b57332f0a0bf921d3123e36f132627a7f3`، `62827ebcbd490f3f86d416b0022f7cedbf58b055` و `dff8be6d66365159ebfbff0591187efbab78dbd6` انجام شد.
- `security-ci` run 272 بعد از اصلاح تست موفق شد.
- Dockerfile مستقل Worker با commit `beca79650d7e9989be829affaacd690e61d252df` اضافه شد و `security-ci` run 274 کامل موفق شد.
- هیچ secret، شماره تلفن، OTP، token، password یا connection URL در کد و این مستند ثبت نشده است.

تعهدهای اصلی پیاده‌سازی:

- Backend API فقط `CONTROL_DATABASE_URL` را برای صف و metadata نیاز دارد.
- فقط Worker باید `PROVISIONING_DATABASE_URL` را داشته باشد.
- Backend و Worker هر دو برای decrypt/encrypt URLهای tenant به `TENANT_DATABASE_ENCRYPTION_KEY` نیاز دارند.
- Worker نباید domain یا exposed port داشته باشد.
- دامنه مدیریت پیشنهادی staging: `admin-staging.amalyar.com`؛ هنوز در Coolify/DNS پیکربندی نشده است.

## کارهای مهم باقی‌مانده

1. تست واقعی SMS آلفا کامل پاس شد: HTTP 201، تحویل موفق، و بدون OTP/شماره در log.
2. مسیر fallback پیامک fail-closed شد، CI run 107 سبز است و deployment نهایی Coolify Running تأیید شد.
3. Frontend resource، دامنه‌های Alpha/Beta، Healthcheck و onboarding فقط از UI کامل و `Running (healthy)` تأیید شده‌اند.
4. تست خودکار قطعی جداسازی به CI اضافه شد و run 226 سبز شد: JWT با `tid` شرکت دیگر 401 می‌شود و Prisma برای Tenantهای متفاوت client/Database route جدا انتخاب می‌کند.
5. تست زنده داده در هر دو جهت پاس و هر دو رکورد ساختگی پاک‌سازی شدند. Platform Admin، provisioning queue/Worker و UI پیاده‌سازی شدند و CI run 274 سبز است؛ مرحله بعد پیکربندی سه resource/route لازم در Coolify staging است.
6. ✅ **انجام شد (`56e7646`، 2026-09-11)** — نشست با کوکیِ `amalyar_session` (HttpOnly, SameSite=Lax, Secure در production) + CSRF double-submit (`amalyar_csrf` ↔ `X-CSRF-Token`)؛ `server/src/auth/session-cookie.ts`. تصمیمِ UX چندحسابی: مجموعهٔ نشست‌های «مرا به خاطر بسپار» سمتِ سرور در کوکیِ HttpOnlyِ امضاشدهٔ `amalyar_sessions`؛ سوییچ با `/auth/switch`. Bearer فقط برای کلاینتِ غیرمرورگری. نکتهٔ دیپلوی: فرانت و `/api` همان origin اند (tenant host) — کوکی host-only است و بینِ tenantها مشترک نمی‌شود. سنجه: `scripts/e2e/cookie-auth.mjs`.
7. انتقال نهایی `PROVISIONING_DATABASE_URL` از Backend به Worker اختصاصی پس از سبز شدن Worker در Coolify.
8. Redis rate limit پیش از چند replica.
9. permission management API/UI و seed صریح.
10. audit برای auth، account admin، permission و emergency support.
11. backup جدا برای هر tenant، offsite encryption و restore drill.
12. رفع npm audit findings بدون `--force` کورکورانه.
13. PgBouncer و connection budget؛ cache فعلی tenant client نامحدود است.
14. object storage برای selfie/files.
15. انتقال DB فعلی production به اولین tenant واقعی.
16. rotation `JWT_SECRET` در cutover تا JWTهای قدیمی بدون tenant باطل شوند.
17. rehearsal کامل migration و rollback قبل از merge.

## ترتیب ادامه کار برای Claude

1. این فایل و `docs/COOLIFY_STAGING_STATE.md` را کامل بخوان.
2. Git branch، commit deployشده و Coolify state را دوباره verify کن.
3. production یا main را بدون اجازه تغییر نده.
4. Watch Paths روی `server/**` ذخیره و تأیید شده؛ آن را حفظ کن.
5. redeploy پس از MELI variables Running و پایدار تأیید شده؛ اکنون ارسال SMS آزمایشی و log را بررسی کن.
6. مشکل log شدن OTP و موفقیت جعلی بدون SMS credential اصلاح شد؛ CI و deployment نهایی هر دو تأیید شدند.
7. Frontend branch، deploy، دامنه‌ها، Healthcheck و ساخت حساب‌های Alpha/Beta فقط از UI تکمیل و تأیید شده است.
8. تست خودکار CI و تست زنده داده در هر دو جهت پاس شده‌اند؛ Platform Admin و Worker نیز پیاده‌سازی و CI شده‌اند. اکنون Coolify staging را مرحله‌ای پیکربندی کن و بعد یک provisioning آزمایشی فقط از UI انجام بده.
9. backup و restore را قبل از production تست کن.
10. PR را Draft نگه دار.

## محدوده فایل‌های تغییرکرده نسبت به main

- `.github/workflows/security-ci.yml`
- `docs/**`
- `server/Dockerfile`
- `server/Dockerfile.worker`
- `server/package.json`
- `server/prisma/control/**`
- `server/prisma/migrations/20260721090000_security_permissions/**`
- `server/prisma/schema.prisma`
- `server/src/audit/**`
- `server/src/auth/**`
- `server/src/common/**`
- `server/src/patients/**`
- `server/src/platform/**`
- `server/src/prisma/**`
- `server/src/scripts/**`
- `server/scripts/**`
- `server/src/tenant/**`
- `server/src/app.module.ts`
- `server/src/main.ts`

مقایسه authoritative: base=`main`، head=`agent/security-permissions-hardening`.

## Coolify Platform Admin activation log — 2026-07-22

- Backend resource: `agent/security-permissions-hardening` در environment `staging`.
- `PLATFORM_ADMIN_ENABLED=true` در Coolify ثبت شد.
- تنظیم تأییدشده: Buildtime خاموش، Runtime روشن، Multiline خاموش، Literal روشن.
- هنوز deployment انجام نشده است.
- مقدار اولیه ۱۵کاراکتری برای `PLATFORM_ADMIN_SECRET` قبل از deployment به‌دلیل کوتاه‌بودن رد شد؛ هیچ deployment با آن انجام نشد.
- `PLATFORM_ADMIN_SECRET` با یک مقدار تصادفی ۶۴کاراکتری در Coolify ثبت و Lock شد؛ مقدار آن در Git/Chat ثبت نشده است.
- تنظیم secret: Buildtime خاموش، Runtime روشن، Multiline خاموش، Literal روشن.
- `PLATFORM_ADMIN_PHONES` در Coolify ثبت و Lock شد؛ مقدار و شماره موبایل عمداً در Git/Chat ثبت نشده است.
- تنظیم allowlist: Buildtime خاموش، Runtime روشن، Multiline خاموش، Literal روشن.
- هر سه متغیر Platform Admin ذخیره شدند و Backend با این مجموعه redeploy شد؛ مالک پروژه وضعیت پایدار/صحیح را تأیید کرد.
- تلاش برای smoke test read-only از مرورگر ابری Agent به‌دلیل policy مرورگر روی دامنه staging رد شد؛ هیچ دورزدنی انجام نشد و نتیجه endpoint از طرف Agent تأییدشده محسوب نمی‌شود.
- DNS دامنه `admin-staging.amalyar.com` به همان سرور staging ثبت شد؛ IP در Git ثبت نشده است.
- دامنه `https://admin-staging.amalyar.com` به Frontend resource `amalyar-frontend-staging` افزوده و Save شد؛ Alpha/Beta حفظ شدند و هنوز redeploy انجام نشده است.
- route `https://admin-staging.amalyar.com/api` به Backend resource افزوده و Save شد؛ routeهای API/Alpha/Beta حفظ شدند.
- نخستین redeploy پس از افزودن route در Docker build شکست خورد: wrapper با exit code 255 متوقف شد و آخرین مرحله قابل‌مشاهده `RUN apk add --no-cache openssl` بود.
- Debug Logs هیچ خطای `apk`/npm/TypeScript نشان نداد؛ Coolify `DeploymentException` با error code 0 ثبت کرد، فرمان `docker exec ... /artifacts/build.sh` قطع شد و build container سپس gracefully stop شد. تشخیص فعلی: شکست build-helper/orchestrator، نه خطای اثبات‌شده در Dockerfile یا برنامه.
- یک redeploy عادی کنترل‌شده تکرار شد و کامل موفق شد؛ Backend با route مدیریت بالا آمد. نتیجه، گذرا بودن failure قبلی build-helper را تأیید می‌کند و نیاز به تغییر Dockerfile ایجاد نشد.
- Frontend resource `amalyar-frontend-staging` پس از افزودن دامنه مدیریت redeploy شد و مالک پروژه موفقیت deployment را تأیید کرد.
- smoke test عمومی `admin-staging` از مرورگر ابری Agent نیز به‌دلیل browser security policy رد شد؛ هیچ workaround انجام نشد و visual routing باید از مرورگر مالک پروژه تأیید شود.
- مالک پروژه visual smoke test را در مرورگر موبایل انجام داد: صفحه مستقل «مدیریت پلتفرم» روی `https://admin-staging.amalyar.com` با HTTPS باز شد؛ صفحه tenant، JSON، 404، 502 و خطای SSL دیده نشد.
- هیچ شماره، OTP، تصویر شخصی یا داده حساس از smoke test در Git ثبت نشده است.
- نسخه قبلی Backend همچنان سبز و `Running` باقی ماند؛ downtime رخ نداد. تا دریافت Debug Logs redeploy تکرار نشود.
- گام بعدی: route دامنه مدیریت در Frontend و Backend و سپس تست OTP فقط از UI.


## ورود بدون دریافت شماره و WebOTP — 2026-07-23

- به درخواست مالک پروژه، فیلد ورود شماره از رابط مدیریت پلتفرم حذف شد؛ مقدار allowlist همچنان فقط در متغیر `PLATFORM_ADMIN_PHONES` روی سرور می‌ماند.
- endpoint عمومی `GET /api/platform/auth/options` فقط برچسب عمومی و شناسه HMAC غیرقابل‌بازگشت برمی‌گرداند؛ شماره خام در response، UI یا log قرار نمی‌گیرد.
- وقتی یک مدیر مجاز وجود داشته باشد، فرانت همان گزینه را خودکار انتخاب می‌کند؛ در حالت چند مدیر، فقط برچسب‌های عمومی برای انتخاب نمایش داده می‌شوند.
- مسیرهای request/verify اکنون `phoneRef` را می‌پذیرند. ورودی قدیمی `phone` موقتاً فقط برای rollout بدون قطعی نگه داشته شده و UI جدید آن را ارسال نمی‌کند.
- WebOTP به صفحه verify افزوده شد و فیلد همچنان `autocomplete="one-time-code"` دارد؛ در مرورگرهای فاقد پشتیبانی، ورود دستی برقرار است.
- `SmsService` خط پایانی origin-bound پیامک را با host معتبر می‌سازد. متغیر جدید `PLATFORM_ADMIN_WEBOTP_HOST` فقط hostname بدون protocol/path می‌گیرد.
- تست CI برای شناسه غیرقابل‌بازگشت، resolve امن، اعتبارسنجی host و قالب origin-bound پیامک اضافه شد.
- آخرین commit این بسته: `1b07c2868fdd55d5d02a5a8b7260b8afb86a692a`. نتیجه CI هنوز در انتظار است.
- مرحله Coolify هنوز انجام نشده: متغیر `PLATFORM_ADMIN_WEBOTP_HOST` باید روی Backend staging ثبت شود، سپس Backend و Frontend redeploy و OTP واقعی از UI تست شود.
- هیچ شماره، OTP، secret یا مقدار حساس در Git ثبت نشده است.


### CI failure observed

- `security-ci` run 340 failed only in step `Verify Platform Admin SMS uses origin-bound WebOTP`.
- Frontend build, Backend build, Prisma validation, tenant isolation, fail-closed config and opaque reference checks all passed.
- Root cause: the inline YAML `run: node -e ...` contained a WebOTP fragment marker; YAML treated the unprotected marker as a comment and the generated shell command ended with an unmatched quote.
- This is a workflow quoting error, not a failure in application/WebOTP behavior.
- Focused fix pending owner approval: convert only this CI command to a YAML block scalar while preserving the same assertion, then rerun CI.


### CI quoting fix applied

- مالک پروژه اجرای اصلاح محدود را تأیید کرد.
- فقط step تست WebOTP از scalar تک‌خطی به YAML block scalar تبدیل شد تا fragment marker پیامک توسط YAML به‌عنوان comment تفسیر نشود.
- منطق برنامه، قالب پیامک و assertion تست تغییر نکرد.
- fix commit: `0334c3831fd45b6450684e36c5edf0500cb2f4d8`; rerun CI در انتظار نتیجه است.


### CI verification complete

- `security-ci` run 350 completed successfully on commit `078235f784b747c624c03f4577353c144cd7452d`.
- Frontend build, Backend build, both Prisma schema validations, tenant isolation, fail-closed Platform Admin config, opaque phone reference and origin-bound WebOTP SMS tests all passed.
- Code is ready for the Coolify staging variable and controlled Backend/Frontend redeploy.


### Coolify WebOTP variable saved

- مالک پروژه تأیید کرد `PLATFORM_ADMIN_WEBOTP_HOST` روی Backend resource در staging اضافه و ذخیره شده است.
- مقدار، hostname دامنه مدیریت staging است و هیچ secret یا شماره‌ای ثبت نشده است.
- Backend هنوز بعد از این تغییر redeploy نشده؛ مرحله بعد redeploy کنترل‌شده Backend و بررسی Running/Healthy و log است.


### Backend WebOTP deployment confirmed

- مالک پروژه تأیید کرد Backend staging پس از افزودن `PLATFORM_ADMIN_WEBOTP_HOST` با redeploy معمولی بالا آمد و وضعیت `Running` دارد.
- مرحله بعد: redeploy فرانت `amalyar-frontend-staging` برای فعال‌شدن رابط بدون فیلد شماره و listener خودکار WebOTP.
- تست واقعی OTP مدیریت هنوز بعد از این deployment انجام نشده است.


### Frontend phone-less login deployment confirmed

- مالک پروژه تأیید کرد `amalyar-frontend-staging` با نسخه جدید با موفقیت deploy شده است.
- Backend و Frontend این بسته اکنون هر دو روی staging مستقر هستند.
- بررسی بعدی قبل از ارسال OTP: صفحه مدیریت باید بدون فیلد شماره نمایش داده شود و فقط کنترل «ارسال کد ورود» برای مدیر ثبت‌شده در سرور داشته باشد.
- تست دریافت و autofill واقعی OTP هنوز انجام نشده است.


### Owner visual verification: phone field removed

- مالک پروژه صفحه مدیریت staging را بعد از deploy باز کرد و تأیید تصویری انجام شد.
- فیلد ورود شماره حذف شده و UI توضیح می‌دهد که شماره مجاز از تنظیم امن سرور انتخاب می‌شود.
- هیچ شماره یا شناسه خام در صفحه نمایش داده نمی‌شود.
- در تصویر، دکمه ارسال کم‌رنگ/احتمالاً disabled دیده می‌شود؛ قبل از OTP smoke test باید امکان کلیک آن از مرورگر مالک تأیید شود.
- تلاش read-only Agent برای endpoint گزینه‌ها دوباره توسط browser safety policy رد شد؛ نتیجه endpoint از سمت Agent تأیید نشده است.


### Phone-less Platform Admin login passed

- مالک پروژه از UI بدون شماره عبور کرد و داشبورد احرازشده مدیریت پلتفرم با موفقیت باز شد.
- این نتیجه تأیید می‌کند گزینه opaque مدیر، درخواست OTP، verify/session cookie و بارگذاری داشبورد عملیاتی هستند.
- هیچ شماره، OTP، نام، تصویر شخصی یا جزئیات رکوردهای نمایش‌داده‌شده در Git ثبت نشده است.
- هنوز باید مشخص شود WebOTP کد را خودکار در فیلد گذاشته یا ورود کد به‌صورت دستی انجام شده است.


### WebOTP end-to-end verified

- مالک پروژه تأیید کرد کد پیامک روی مرورگر موبایل به‌صورت خودکار داخل جریان ورود قرار گرفت؛ ورود دستی شماره و کد لازم نبود.
- تست staging کامل پاس شد: server allowlist → opaque reference → SMS origin binding → browser WebOTP autofill → secure verify/session → authenticated dashboard.
- قابلیت ورود بدون شماره و autofill کد اکنون در staging کامل و عملیاتی است.


## Provisioning Worker activation started — 2026-07-23

- مالک پروژه شروع راه‌اندازی Worker اختصاصی در Coolify staging را تأیید کرد.
- کد جاری دوباره بررسی شد: image در `server/Dockerfile.worker` هیچ portی expose نمی‌کند و command ثابت `node dist/scripts/provisioning-worker.js` دارد.
- Worker در startup وجود `CONTROL_DATABASE_URL`، `PROVISIONING_DATABASE_URL` و `TENANT_DATABASE_ENCRYPTION_KEY` را fail-closed بررسی می‌کند.
- Worker نباید Domain، Exposed Port، Healthcheck HTTP، JWT secret یا SMS credentials دریافت کند.
- نام پیشنهادی resource جدید: `amalyar-provisioning-worker-staging`.
- هنوز resource جدید ساخته نشده و هیچ متغیر یا credential جابه‌جا نشده است.


### Worker creation form reached

- در Coolify project `Amalyar` و environment `staging`، فرم Create a new Application برای repo `Amalyar` باز شد.
- هنوز Continue زده نشده و resource ساخته نشده است.
- تنظیم بعدی: branch کاری، Dockerfile build pack، base directory `/server` و Port خالی.


### Worker application resource created, not deployed

- Coolify application resource از repo و branch کاری در staging ساخته شد.
- Build Pack و Base Directory به‌ترتیب `Dockerfile` و `/server` هستند.
- Coolify به‌صورت پیش‌فرض یک دامنه موقت، Traefik labels و exposed port ایجاد کرده است؛ این‌ها برای Worker باید قبل از نخستین deployment کامل حذف شوند.
- Dockerfile هنوز default `/Dockerfile` است و باید به `/Dockerfile.worker` تغییر کند.
- resource هنوز deploy نشده و هیچ Worker process اجرا نشده است.

### Worker non-public configuration saved

- Coolify resource name: `amalyar-provisioning-worker-staging`.
- Build configuration: Base Directory `/server`, Dockerfile Location `/Dockerfile.worker`, Watch Paths `server/**`.
- Non-public Worker configuration verified: Domains, Ports Exposes, Port Mappings, Network Aliases, and container/Traefik labels are empty.
- HTTP Basic Authentication is disabled; pre-deployment and post-deployment commands are empty.
- No manual deployment was started during this configuration step.
- Coolify UI showed `2 deployments`; before adding environment variables, inspect the resource status and deployment history to detect any webhook-triggered incomplete run.
- No secrets or temporary generated domain/IP values are recorded here.

### Worker runtime variables saved and automatic deployment paused

- Coolify resource: `amalyar-provisioning-worker-staging` in the `staging` environment.
- Configured variable names only: `CONTROL_DATABASE_URL`, `PROVISIONING_DATABASE_URL`, `TENANT_DATABASE_ENCRYPTION_KEY`, and `PROVISIONING_POLL_MS=5000`.
- Secret values remain only in Coolify and are not recorded in Git.
- Variable flags confirmed by the owner: Buildtime off, Runtime on, Multiline off, Literal on.
- Before the variables were configured, documentation commits triggered two Webhook deployments: one was cancelled; one completed the deployment but the Worker entered a restart loop because runtime configuration had not yet been applied. A successful deployment badge was not treated as runtime-health proof.
- Coolify `Auto Deploy` is now disabled for this Worker so documentation commits cannot trigger additional deployments during setup.
- The Worker remains non-public: no domain, exposed port, port mapping, network alias, Traefik/container label, HTTP Basic Authentication, or pre/post deployment command.
- Next verification step: perform one manual deployment, then confirm stable runtime and inspect logs without exposing connection URLs or secrets.

### Worker manual deployment stable

- After configuring the Worker runtime variables and disabling Auto Deploy, one manual deployment was performed.
- Coolify reports `Running (unknown)`, which is expected for this non-HTTP background process.
- No restart counter is shown after the manual deployment.
- The log view shows `No logs yet`; this is expected while no provisioning job is queued because the Worker is intentionally silent while idle.
- No secret values, connection URLs, tenant test data, or container identifiers are recorded.
- Next functional verification: submit one controlled staging provisioning job through the Platform Admin UI and confirm the Worker records a safe success/failure result.

### First UI-driven Worker provisioning test

- A controlled third staging tenant was submitted only through the Platform Admin UI.
- The provisioning queue moved from running to ready/succeeded, and the tenant appeared active in the platform list.
- This verifies the UI → Control DB job → dedicated Worker → isolated PostgreSQL database/role path without exposing credentials in the UI or API.
- The tenant name, slug, hostname, database name, role name, and all other test-record values are intentionally not recorded.
- Opening the generated hostname returned `DNS_PROBE_FINISHED_NXDOMAIN`.
- The NXDOMAIN result is a DNS/ingress gap, not a Worker or database-provisioning failure: no wildcard DNS record and catch-all HTTPS routing have yet been configured for arbitrary tenant hostnames.
- Next infrastructure step: configure a one-time wildcard DNS record, a wildcard TLS certificate through DNS challenge, and catch-all SaaS routing for the shared Frontend and the more-specific Backend `/api` route. Per-tenant manual DNS entries are rejected because onboarding must remain UI-driven and automatable.

### Authoritative DNS provider confirmed

- The authoritative DNS zone for `amalyar.com` is managed through HostIran Cloud DNS.
- No DNS account credential, API token, server IP, or record value is stored in Git.
- The next one-time step is to add a wildcard `A` record whose target matches the existing staging application records, then verify propagation before changing Coolify catch-all routing or TLS.
- Wildcard TLS automation remains unresolved until HostIran DNS API/DNS-challenge compatibility is confirmed; no unsafe proxy change has been applied.

### Wildcard DNS A record saved

- در HostIran Cloud DNS یک رکورد wildcard از نوع `A` برای `*.amalyar.com` ذخیره شد.
- مقدار مقصد همان مقصد رکوردهای موجود staging است و عمداً در Git ثبت نشده است.
- TTL رکورد `14400` ثانیه است.
- رکوردهای صریح فعلی مانند دامنه‌های staging بر wildcard اولویت دارند.
- انتشار DNS هنوز از بیرون تأیید نشده است؛ بررسی resolver محلی Agent به‌علت محدودیت شبکه/DNS محیط قابل اتکا نبود و بررسی مرورگر مالک پس از propagation لازم است.
- هنوز هیچ catch-all label در Coolify و هیچ تغییر wildcard TLS اعمال نشده است.
- مرحله بعد، تعیین سازگاری HostIran DNS با ACME DNS challenge است؛ تا روشن‌شدن این مورد تنظیمات proxy تغییر نمی‌کند.

### HostIran DNS challenge compatibility unresolved

- جست‌وجوی مستندات عمومی و رسمی قابل‌دسترسی، راهنمای API token یا ACME DNS challenge برای HostIran Cloud DNS پیدا نکرد.
- نبود نتیجه عمومی به‌معنای نبود قطعی API نیست؛ ممکن است قابلیت فقط در پنل یا از طریق پشتیبانی ارائه شود.
- تا زمان تأیید API سازگار، هیچ تغییر catch-all routing، Traefik DNS challenge یا wildcard TLS در Coolify اعمال نمی‌شود.
- مرحله بعد فقط بررسی پنل HostIran برای گزینه‌ای با عنوان API، API Key، Token یا دسترسی API است؛ هیچ token یا credential نباید در Chat یا Git فرستاده شود.

### HostIran panel API not available

- مالک پروژه پنل HostIran Cloud DNS را بررسی کرد و گزینه‌ای برای API، API key، token یا دسترسی برنامه‌نویسی پیدا نکرد.
- همراه با نبود مستندات عمومی رسمی، HostIran DNS فعلاً برای ACME DNS challenge خودکار قابل‌استفاده در نظر گرفته نمی‌شود؛ این نتیجه به‌معنای ادعای قطعی درباره امکانات داخلی پشتیبانی HostIran نیست.
- رکورد wildcard `A` موجود حفظ می‌شود و هیچ رکورد tenant به‌صورت دستی ساخته نخواهد شد.
- برای wildcard TLS کاملاً خودکار، پیشنهاد معماری انتقال فقط مدیریت authoritative DNS به یک provider دارای API سازگار (ترجیحاً Cloudflare) است؛ ثبت/مالکیت دامنه لازم نیست منتقل شود.
- هیچ nameserver، proxy، TLS یا Coolify catch-all routing هنوز تغییر نکرده است و اجرای این تصمیم منتظر تأیید مالک پروژه است.

### Temporary manual tenant-domain activation

- مالک پروژه فعلاً انتقال authoritative DNS به provider خارجی را به‌دلیل نگرانی از دسترس‌پذیری هنگام اختلال اینترنت بین‌الملل رد کرد.
- راهکار موقت مصوب: provisioning دیتابیس/role توسط UI و Worker خودکار می‌ماند؛ فعال‌سازی دامنه در مرحله پایانی به‌صورت دستی انجام می‌شود.
- برای هر tenant جدید، اپراتور پس از موفقیت provisioning باید DNS و route دقیق همان hostname را تکمیل و HTTPS را بررسی کند؛ tenant نباید صرفاً با موفقیت ساخت دیتابیس «قابل‌دسترسی عمومی» تلقی شود.
- رکورد wildcard فعلی حذف یا تغییر داده نشده است. تا مشخص‌شدن propagation و routing، ساخت رکوردهای اضافی باید با بررسی عدم تداخل انجام شود.
- هیچ DNS record، nameserver، proxy یا Coolify label در این تصمیم تغییر نکرد.
- گزینه‌های ایرانی سازگار برای خودکارسازی آینده:
  - ArvanCloud با provider code `arvancloud` و credential name `ARVANCLOUD_API_KEY`.
  - Liara با provider code `liara` و credential name `LIARA_API_KEY`.
- هر دو provider در فهرست رسمی Lego، کتابخانه مورداستفاده Traefik برای DNS-01، پشتیبانی می‌شوند. انتخاب یا مهاجرت به آن‌ها هنوز انجام نشده و نیازمند بررسی سرویس، هزینه و برنامه انتقال بدون قطعی است.
- هیچ API key یا credential در Git ثبت نشده است.

### First manual tenant-domain routing attempt

- دامنه tenant جدید پس از تنظیم DNS دیگر `NXDOMAIN` نیست و درخواست به proxy سرور Coolify می‌رسد.
- hostname دقیق tenant و سایر داده‌های تست عمداً ثبت نشده‌اند.
- دامنه ریشه به Frontend و مسیر همان دامنه با `/api` به Backend اضافه شده است.
- تست مرورگر فعلاً `NET::ERR_CERT_AUTHORITY_INVALID` نشان داد؛ پس گواهی معتبر هنوز برای hostname صادر یا ارائه نشده است.
- پس از عبور آزمایشی از هشدار، پاسخ `no available server` دیده شد؛ یعنی Traefik route را می‌شناسد اما برای route جاری endpoint سالم/قابل‌دسترس پیدا نکرده است.
- این مرحله موفق تلقی نمی‌شود و هیچ credential یا داده کاربری نباید تا رفع TLS و upstream وارد شود.
- بررسی بعدی باید ابتدا صحت رشته Domains و deployment جاری Frontend را تأیید کند؛ سپس Backend و صدور certificate بررسی شود.


---

## Wildcard TLS با DNS-01 روی ArvanCloud — تکمیل شد (2026-07-26)

مسئلهٔ «برای هر tenant جدید باید دستی دامنه اضافه شود» **حل شد**. از این پس هر
زیردامنهٔ `*.amalyar.com` بدون هیچ کار دستی در Coolify با HTTPS معتبر بالا می‌آید.

### تصمیم و دلیلش
گزینهٔ «خودکارسازی با API خودِ Coolify» رد نشد ولی انتخاب نشد، چون wildcard TLS
ریشهٔ مسئله را می‌بندد: یک گواهی برای همیشه، بدون سقف نرخِ Let's Encrypt و بدون
وابستگی به API پنل.

پیش‌شرطِ آن، DNS با API سازگار بود. HostIran API ندارد؛ انتقال به Cloudflare قبلاً
به‌دلیل نگرانی از قطعی اینترنت بین‌الملل رد شده بود. **ArvanCloud** انتخاب شد:
ایرانی، در فهرست رسمی Lego، و DNS آن بدون خرید پلن CDN کار می‌کند.

### واقعیت‌هایی که با آزمایش تأیید شدند
- **DNS آروان بدون پلن رایگان است.** در اسپکِ API، `DomainStore` فقط `domain` را
  required دارد و `plan_level` اختیاری است. ویزارد پلن‌های CDN را جلو می‌آورد ولی
  رد کردنشان مسیر رسمی است، نه دور زدن.
- **آروان کل زون را import نمی‌کند.** طبق `import_dns_records` فقط رکوردهای A برای
  `@`، `www` و تشخیصِ wildcard ساخته می‌شود. هر رکورد دیگری (اینجا `MX`) باید دستی
  اضافه شود، وگرنه بی‌صدا جا می‌مانَد.
- **سرورهای authoritative آروان به کوئری خارج از ایران جواب نمی‌دهند.** تست مستقیم
  با `RD=0` از بیرون `SERVFAIL`/`AA=0` می‌دهد و **گمراه‌کننده است**. معیار درست،
  پرسش از resolverهای عمومی و نگاه‌کردن به TTL است: TTLِ برابر با مقدارِ تنظیم‌شده
  در آروان یعنی پاسخ از زون زنده می‌آید، نه از کش.
- **ابرِ آروان باید خاموش (DNS only) بماند.** پیام «در این حالت HTTPS فعال نمی‌شود»
  به HTTPSِ خودِ CDN آروان اشاره دارد، نه به سایت. اگر ابر روشن شود، آروان TLS را
  terminate می‌کند و کل هدفِ گواهی wildcard روی Traefik از بین می‌رود.
- سرور در ایران است (AS59441)، پس دسترسی به `napi.arvancloud.ir` مشکلی ندارد.
  اگر سرور خارج بود، این معماری از پایه کار نمی‌کرد.

### پیکربندی
`ARVANCLOUD_API_KEY` باید پیشوند `Apikey ` داشته باشد (طبق مستندات lego)، نه UUID خالی.
`resolvers` عمداً روی nameserverهای خودِ آروان تنظیم شده، نه `1.1.1.1`/`8.8.8.8` که
در ایران ممکن است فیلتر یا دستکاری شوند.

گواهی جدید در `/traefik/acme-arvan.json` ذخیره می‌شود — **جدا از** `acme.json` که
گواهی‌های HTTP-01 موجود در آن است. resolverِ `letsencrypt` دست‌نخورده ماند تا اگر
DNS-01 خراب شود، هیچ دامنهٔ فعلی آسیب نبیند.

### routerِ wildcard
در `/data/coolify/proxy/dynamic/wildcard.yaml` تعریف شده، نه در labelهای اپ‌ها.
دلایل:
- Coolify پوشهٔ `dynamic/` را دست نمی‌زند، پس با redeploy یا Restart Proxy از بین نمی‌رود.
- Traefik با `--providers.file.watch=true` بدون ری‌استارت می‌خوانَدش.
- فایل جداست؛ اگر خراب باشد فقط همان router کار نمی‌کند و بقیهٔ سایت سالم می‌ماند.

**اولویت ۱ و ۲ عمدی است.** routeهای صریحِ Coolify اولویتِ پیش‌فرضشان برابر طولِ قاعده
(~۵۰) است، پس همیشه برنده‌اند و wildcard فقط پشتیبانِ زیردامنه‌های تعریف‌نشده است.
این تنها چیزی بود که مانع از دزدیدنِ ترافیکِ محیط staging توسط wildcard شد.

routerِ `/api` به middleware‌ی strip نیاز ندارد، چون `restoreApiPrefix` در بک‌اند
idempotent است (`/api/x → /api/x`) — یک نقطهٔ شکستِ کمتر.

### ⚠️ تلهٔ عملیاتی: Coolify فایل پروکسی را بازتولید می‌کند
`/data/coolify/proxy/docker-compose.yml` هنگام Start/Restart Proxy **از روی کانفیگِ
ذخیره‌شده در دیتابیس Coolify از نو نوشته می‌شود**. پس ویرایش مستقیم فایل موقتی است و
با اولین ری‌استارتِ UI می‌پرد. تنظیمات پایدار باید در UI (Proxy → Configuration) ذخیره شود.

ترتیب درست: **ویرایش → Save → تأیید در فایل → تازه Restart.** اگر بدون Save ری‌استارت
بزنی، Coolify نسخهٔ قدیمی را دوباره می‌نویسد و ویرایشت پاک می‌شود.

### ⚠️ ویرایشگر کانفیگ Coolify، YAML پیست‌شده را خراب می‌کند
ویرایشگر auto-indent دارد و به هر خطِ پیست‌شده تورفتگی اضافه می‌کند. یک‌بار همین
باعث شد `services:` زیر `networks:` برود و کل پروکسی بالا نیاید (سایت خوابید).

**راه‌حل: کانفیگ را به‌صورت JSON تک‌خطی بنویس.** YAML زیرمجموعهٔ JSON را می‌پذیرد و
یک خطِ واحد هیچ خطی ندارد که auto-indent رویش عمل کند. این روش تست شد و از یک
Restart کاملِ Coolify سالم بیرون آمد.

### بازیابی اضطراری اگر پروکسی بالا نیامد
`panel.amalyar.com` هم از Traefik رد می‌شود، پس با خوابیدن پروکسی از دسترس خارج می‌شود.
راه‌های ورود:
- Coolify مستقیم روی پورت ۸۰۰۰: `http://<SERVER_IP>:8000`
- ترمینالِ Coolify با انتخاب **localhost** = شلِ خودِ سرور با root (معادل SSH).
  انتخاب یک کانتینر (مثل `coolify-proxy`) شلِ داخلِ آن است و `docker` ندارد.

قبل از هر تغییرِ پروکسی یک پشتیبان بگیر و برگشت را یک‌خطی نگه دار:
```
cp /data/coolify/proxy/docker-compose.yml /root/proxy-good.yml
# برگشت:
cp /root/proxy-good.yml /data/coolify/proxy/docker-compose.yml && \
  docker compose -f /data/coolify/proxy/docker-compose.yml up -d --force-recreate
```
همیشه پیش از اجرا `docker compose -f ... config -q` بزن؛ همین یک قدم جلوی خرابیِ دوم را گرفت.

> ترمینالِ وبِ Coolify هر چند دقیقه reconnect می‌شود و `cd` را صفر می‌کند. در همهٔ
> دستورها **مسیر مطلق** بده. متغیرهای شل (مثل کلیدی که با `read` گرفته شده) هم بین
> دو دستور زنده نمی‌مانند؛ به‌جای `read`، placeholder بنویس و با `sed` جایگزین کن.

### باگی که wildcard آشکار کرد
با wildcard هر زیردامنه‌ای به فرانت می‌رسد. `Login.jsx` خطای ۴۰۴ِ «شرکت یافت نشد» را
در یک `catch` خالی می‌بلعید و فرمِ ورودِ کامل نشان می‌داد — یعنی `zereshk.amalyar.com`
هم صفحهٔ ورود داشت. رفع شد: حالا ۴۰۴ِ میان‌افزارِ tenant تشخیص داده می‌شود و پیامِ
«شرکتی روی این نشانی نیست» نمایش داده می‌شود.

### وضعیت نهایی
- delegation روی `c.ns.arvancdn.ir` / `z.ns.arvancdn.ir`؛ رکوردهای HostIran عمداً
  دست‌نخورده ماندند تا propagation کامل شود.
- گواهی `amalyar.com` + `*.amalyar.com` صادر و فعال.
- محیط staging کامل حذف شد (اپ‌ها، Worker، دیتابیس و volume آن)؛ هیچ volume یا
  کانتینرِ یتیمی نماند. ~۲ گیگ دیسک و ~۲۳۰ مگ RAM آزاد شد.
- شرکت‌های تستی پروداکشن با همان جریانِ حذفِ امن (تأیید شناسه + OTP) پاک شدند.
- ایمیج‌های غیرفعال (~۱.۳G) عمداً نگه داشته شدند چون امکانِ rollback را می‌دهند.

## سئوی per-tenant و متغیرِ API_UPSTREAM — 2026-09-11

صفحهٔ معرفیِ هر شرکت تا امروز فقط سمتِ کلاینت عنوان می‌گرفت، پس خزندهٔ
پیش‌نمایشِ لینک (واتساپ/تلگرام/ایتا/بله/لینکدین) که JS اجرا نمی‌کند، لینکِ
دامنهٔ هر مشتری را با نام و توضیحِ **عمل‌یار** نشان می‌داد.

**چه چیزی اضافه شد**

| مسیرِ عمومی (فرانت) | از کجا می‌آید |
|---|---|
| `/` | `index.html` + تزریقِ SSI از `/api/public/site/head` |
| `/robots.txt` | پراکسی به `/api/public/site/robots.txt` |
| `/sitemap.xml` | پراکسی به `/api/public/site/sitemap.xml` |

هر سه از **Host** تنانت را حل می‌کنند (قانونِ ۱۸)، پس هر دامنه سئوی خودش را
می‌گیرد. سایتِ منتشرنشده `Disallow: /` و `noindex` می‌گیرد.

**⚠️ یک کارِ دستی در Coolify (یک‌بار، نه per-tenant)**

اپِ فرانت حالا یک متغیرِ محیطی می‌خواهد:

`API_UPSTREAM` **دو مقدارِ معتبر** دارد:

| مقدار | کِی | نکته |
|---|---|---|
| `http://<نامِ کانتینرِ بک‌اند>:3001` | وقتی هر دو اپ روی یک شبکهٔ داکرند | سریع‌تر (بدونِ TLS، بدونِ عبور از پراکسی). نیاز به «Connect To Predefined Network» روی هر دو اپ + نامِ قطعی (Custom Container Name یا Consistent Container Names) |
| `https://api.amalyar.com` | وقتی شبکهٔ مشترک ندارند | **هیچ پیکربندیِ شبکه‌ای نمی‌خواهد.** درخواست از همان پراکسیِ بیرونی رد می‌شود؛ چون `Host` دست‌نخورده می‌ماند به tenantِ درست می‌رسد. `proxy_ssl_server_name on` در قالب هست وگرنه دست‌دادنِ TLS بی‌صدا می‌شکست |

```
API_UPSTREAM=https://api.amalyar.com
```

پیش‌فرضِ `Dockerfile` مقدارِ `http://amalyar-api:3001` است. اگر نامِ سرویس چیزِ
دیگری باشد یا دو اپ روی یک شبکهٔ داکر نباشند، **چیزی خراب نمی‌شود**: قطعهٔ سئو
خالی می‌ماند (SSI با `ssi_silent_errors`) و `robots`/`sitemap` به نسخهٔ ایستای
`public/` برمی‌گردند. یعنی رفتار امروز، نه صفحهٔ سفید.

برای اینکه دو اپ همدیگر را ببینند، در Coolify گزینهٔ «Connect to Predefined
Network» روی هر دو اپ باید روشن باشد.

**چطور بسنجیم که کار می‌کند** (بعد از دیپلوی، از بیرون):

```bash
curl -s https://<دامنهٔ شرکت>/ | head -40        # باید <title> نامِ شرکت باشد نه عمل‌یار
curl -s https://<دامنهٔ شرکت>/robots.txt          # باید Sitemap همان دامنه را بدهد
curl -s https://<دامنهٔ شرکت>/sitemap.xml
```

اگر `<title>` هنوز «عمل‌یار …» بود یعنی `API_UPSTREAM` به بک‌اند نمی‌رسد.

### ⚠️ باگِ fallback که روی سرور دیده شد — ۱۴۰۵/۰۶/۲۰

اولین تستِ `https://<tenant>/robots.txt` روی production یک **۴۰۴ خامِ nginx**
داد، نه پاسخِ بک‌اند و نه فایلِ ایستا. علت در خودِ کانفیگ بود:

```nginx
rewrite ^ /api/public/site/robots.txt break;   # ← $uri را عوض می‌کند
location @seo_static { try_files $uri =404; }  # ← دنبالِ همان مسیرِ API روی دیسک
```

`rewrite` مقدارِ `$uri` را تغییر می‌دهد، پس fallback به‌جای `/robots.txt` دنبالِ
`/api/public/site/robots.txt` روی دیسک می‌گشت. حالا مسیرِ اصلی **پیش از**
rewrite در `$seo_file` ذخیره می‌شود و `verify-seo-surface.js` هم همین را
می‌سنجد (روی هر دو شکلِ نقض قرمز شد).

هم‌زمان هدرِ `X-Seo-Source` اضافه شد تا از بیرون معلوم باشد پاسخ از کدام مسیر
آمده:

```bash
curl -sI https://<دامنه>/robots.txt | grep -i x-seo-source
# backend → از API آمده   ·   static → فایلِ public/   ·   نبودِ هدر → هیچ‌کدام
```

**تشخیصِ اینکه بک‌اند در دسترس است یا نه** (مستقل از nginx) — این نشانی از
Traefik مستقیم به بک‌اند می‌رود:

```
https://<دامنه>/api/public/site/robots.txt
```

- پاسخِ robots → بک‌اند و resolveِ tenant سالم‌اند؛ مشکل فقط `API_UPSTREAM` است.
- «شرکت برای این دامنه یافت نشد» → آن دامنه در `tenant_domains` ثبت نشده.

**نکتهٔ عملیاتیِ جدا:** `nginx.conf` حذف شد و جایش `nginx.conf.template` آمد
(ایمیجِ nginx با envsubst پردازشش می‌کند). هر تغییرِ آیندهٔ کانفیگ باید روی
قالب باشد.
