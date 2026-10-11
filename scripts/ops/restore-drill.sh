#!/usr/bin/env bash
# تمرینِ بازگردانی — پشتیبان را در یک Postgresِ **تازه و دورریختنی** برمی‌گرداند و می‌سنجد که واقعاً برگشته است.
# پشتیبانی که هرگز بازگردانده نشده باشد، فقط یک فایل است؛ این اسکریپت همان «بازگردانی»ی شبِ فاجعه را از پیش، روی
# سرورِ دورریختنی، اجرا می‌کند. **هرگز به دیتابیسِ زنده دست نمی‌زند.**
#
# چه می‌سنجد (هر کدام شکست بخورد، کدِ خروجی غیرصفر و علتِ فارسی چاپ می‌شود):
#   ۱. چکیده‌ها (SHA256SUMS) — فایلِ دستکاری‌شده یا نیمه‌کاره
#   ۲. نقش‌ها (globals.sql) بدونِ خطا برمی‌گردند و هر نقشِ پشتیبان واقعاً ساخته می‌شود
#   ۳. هر دامپ بدونِ خطا برمی‌گردد (pg_restore --create، با همان مالکِ اصلی)
#   ۴. دیتابیسِ مرکزی (جدول tenants) در پشتیبان هست و دیتابیسِ **هر** شرکتِ فعال — با نامش (`amalyar_<شناسه>`) — برگشته
#      و migration دارد؛ نقشِ هر شرکت با اجازهٔ ورود و رمز برگشته
#   ۵. هر فایلی که دیتابیسِ یک شرکت به آن ارجاع می‌دهد (مدرک، اثباتِ تحویل، عکسِ سایت، سربرگ) در پوشهٔ **همان شرکت**
#      در storage.tar.gz هست
# و در پایان شمارِ ردیف‌های هر شرکت و **زمانِ بازگردانی** را می‌گوید (همان «چقدر طول می‌کشد؟»ی شبِ فاجعه).
#
# اجرا روی میزبانِ سرور (Docker لازم است؛ یک کانتینرِ postgres:18-alpine موقت می‌سازد و در پایان پاک می‌کند):
#   sudo bash restore-drill.sh                    # آخرین پشتیبان در /var/backups/amalyar
#   sudo bash restore-drill.sh 20261007T020000Z   # یک پشتیبانِ مشخص (نام یا مسیر)
# اگر پشتیبان رمزشده بود: BACKUP_PASSPHRASE از همان فایلِ تنظیماتِ backup.sh (/etc/amalyar-backup.env) خوانده می‌شود —
# رمز در خطِ فرمان نمی‌آید (تاریخچهٔ شل و لاگِ sudo). BACKUP_ENV=… فایلِ دیگری را نشان می‌دهد.
#
# بدونِ Docker (آزمون): یک سرورِ **خالی** و دورریختنی را با PGHOST/PGPORT/PGUSER نشان بده و DRILL_LOCAL=yes بگذار؛
# اگر آن سرور جز postgres دیتابیسی داشته باشد اسکریپت می‌ایستد (مبادا روی سرورِ زنده بازگردانده شود).
set -uo pipefail

say() { printf '%s\n' "$*"; }
FAILS=0; WARNS=0
bad() { printf '  ✘ %s\n' "$*"; FAILS=$((FAILS + 1)); }
good() { printf '  ✔ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; WARNS=$((WARNS + 1)); }
die() { printf 'خطا: %s\n' "$*" >&2; exit 2; }

# همان خوانندهٔ متنیِ «کلید=مقدار»ِ backup.sh (نه `source`: رمزِ دارای $ و ` و فاصله همان‌طور می‌ماند). این‌جا فقط
# BACKUP_DIR و BACKUP_PASSPHRASE به کار می‌آیند؛ بقیهٔ کلیدهای همان فایل نادیده گرفته می‌شوند.
ENV_KEYS=" PG_CONTAINER PG_USER STORAGE_VOLUME STORAGE_DIR SKIP_STORAGE BACKUP_DIR RETENTION_DAYS BACKUP_PASSPHRASE RCLONE_REMOTE "
load_env() {
  local f="$1" line key val n=0
  [ -f "$f" ] || return 0
  [ -r "$f" ] || die "فایلِ تنظیمات خواندنی نیست: $f (با sudo اجرا کن)"
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1)); line="${line%$'\r'}"
    case "$line" in ''|'#'*|[[:space:]]'#'*) continue;; esac
    [[ "$line" == *=* ]] || die "خطِ $n در $f «کلید=مقدار» نیست"
    key="${line%%=*}"; val="${line#*=}"
    key="${key#export }"; key="${key//[[:space:]]/}"
    case "$ENV_KEYS" in *" $key "*) ;; *) die "کلیدِ ناشناخته در $f (خطِ $n): $key";; esac
    case "$key" in BACKUP_DIR|BACKUP_PASSPHRASE) ;; *) continue;; esac
    if [ "${#val}" -ge 2 ]; then
      case "$val" in \'*\') val="${val:1:${#val}-2}";; \"*\") val="${val:1:${#val}-2}";; esac
    fi
    [ -n "${!key+x}" ] || printf -v "$key" '%s' "$val"
  done < "$f"
}
load_env "${BACKUP_ENV:-/etc/amalyar-backup.env}"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/amalyar}"
DRILL_IMAGE="${DRILL_IMAGE:-postgres:18-alpine}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-}"
DRILL_LOCAL="${DRILL_LOCAL:-}"
ARG="${1:-}"
in_list() { local x="$1"; shift; local y; for y in "$@"; do [ "$x" = "$y" ] && return 0; done; return 1; }

START="$(date +%s)"

# ── پشتیبانِ مبدأ ──
if [ -z "$ARG" ]; then
  [ -f "$BACKUP_DIR/LATEST" ] || die "پشتیبانی پیدا نشد ($BACKUP_DIR/LATEST)؛ نامِ پوشه را بده"
  ARG="$(cat "$BACKUP_DIR/LATEST")"
fi
if [ -d "$ARG" ]; then SRC="$ARG"; elif [ -d "$BACKUP_DIR/$ARG" ]; then SRC="$BACKUP_DIR/$ARG"; else die "پوشهٔ پشتیبان پیدا نشد: $ARG"; fi
SRC="$(cd "$SRC" && pwd)"
say "تمرینِ بازگردانی — $(basename "$SRC")"

# ── سرورِ دورریختنی ──
CLEAN_DOCKER=""
W="$(mktemp -d)"
cleanup() { rm -rf "$W"; [ -z "$CLEAN_DOCKER" ] || docker rm -f "$CLEAN_DOCKER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if [ -n "$DRILL_LOCAL" ]; then
  [ "$DRILL_LOCAL" = yes ] || die "برای سرورِ محلی DRILL_LOCAL=yes بگذار"
  SU="${PGUSER:-postgres}"
  pgx() { "$@"; }
  others="$(psql -U "$SU" -d postgres -X -qAt -c "SELECT count(*) FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres'" 2>/dev/null || echo ?)"
  [ "$others" = 0 ] || die "سرورِ تمرین باید خالی باشد (جز postgres $others دیتابیس دارد) — هرگز روی سرورِ زنده بازگردانی نکن"
  # خودِ `postgres` هم باید خالی باشد: در نصبِ واقعی دیتابیسِ مرکزی همان‌جاست، پس «فقط postgres دارد» یعنی هنوز شاید زنده.
  pgt="$(psql -U "$SU" -d postgres -X -qAt -c "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')" 2>/dev/null || echo ?)"
  [ "$pgt" = 0 ] || die "سرورِ تمرین باید خالی باشد (دیتابیسِ postgres $pgt جدول دارد) — هرگز روی سرورِ زنده بازگردانی نکن"
else
  command -v docker >/dev/null 2>&1 || die "Docker پیدا نشد؛ یا Docker نصب کن یا یک سرورِ خالی را با DRILL_LOCAL=yes و PG* نشان بده"
  NAME="amalyar-drill-$$"
  docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=drill "$DRILL_IMAGE" >/dev/null || die "کانتینرِ تمرین بالا نیامد ($DRILL_IMAGE)"
  CLEAN_DOCKER="$NAME"
  SU=postgres
  pgx() { docker exec -i "$NAME" "$@"; }
  ready=""
  for _ in $(seq 1 90); do
    # postgres:* پس از initdb یک‌بار ری‌استارت می‌شود؛ تا دو بارِ «ready» صبر می‌کنیم تا میانهٔ همان ری‌استارت وصل نشویم.
    if [ "$(docker logs "$NAME" 2>&1 | grep -c 'database system is ready to accept connections')" -ge 2 ] \
       && pgx psql -U "$SU" -d postgres -X -qAt -c 'SELECT 1' >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
  done
  [ -n "$ready" ] || die "سرورِ تمرین آماده نشد"
fi
psql_q() { pgx psql -U "$SU" -d postgres -X -qAt "$@"; }
psql_db() { local db="$1"; shift; pgx psql -U "$SU" -d "$db" -X -qAt "$@"; }
say "  سرورِ تمرین: $(psql_q -c 'SHOW server_version' 2>/dev/null || echo ؟)"

# ── ۱) چکیده‌ها ──
if [ -f "$SRC/FAILED" ]; then bad "پشتیبان خودش ناقص علامت خورده است ($SRC/FAILED)"; fi
if [ -f "$SRC/SHA256SUMS" ]; then
  if (cd "$SRC" && sha256sum -c --quiet SHA256SUMS >/dev/null 2>&1); then good "چکیدهٔ همهٔ فایل‌ها درست است"; else bad "چکیده‌ها نمی‌خوانند — فایلی دستکاری یا ناقص شده"; (cd "$SRC" && sha256sum -c SHA256SUMS 2>&1 | grep -v ': OK$' | head -5); fi
else bad "SHA256SUMS نیست"; fi

# ── رمزگشایی (اگر لازم) ──
shopt -s nullglob
for f in "$SRC"/*; do
  b="$(basename "$f")"
  case "$b" in
    SHA256SUMS|MANIFEST.txt|FAILED|UPLOAD_FAILED) continue;;
    *.enc)
      [ -n "$BACKUP_PASSPHRASE" ] || die "پشتیبان رمزشده است؛ BACKUP_PASSPHRASE را بگذار"
      export BACKUP_PASSPHRASE
      openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$f" -out "$W/${b%.enc}" 2>/dev/null || { bad "رمزگشایی ${b} شکست خورد (رمز اشتباه؟)"; rm -f "$W/${b%.enc}"; } ;;
    *) ln -s "$f" "$W/$b";;
  esac
done
[ -f "$W/globals.sql" ] || { bad "globals.sql (نقش‌ها) در پشتیبان نیست"; }

# ── ۲) نقش‌ها ──
if [ -f "$W/globals.sql" ]; then
  # خطاهای «نقشِ postgres از قبل هست» عادی‌اند؛ ملاک ساخته‌شدنِ هر نقشِ پشتیبان است نه خروجیِ psql.
  pgx psql -U "$SU" -d postgres -X -q < "$W/globals.sql" > /dev/null 2> "$W/globals.err" || true
  miss=0; total=0
  # ⚠️ فهرست از fd 3 خوانده می‌شود: در حالتِ Docker `psql_q` همان `docker exec -i` است که ورودیِ استاندارد را می‌بلعد —
  # با `done < <(…)` فقط نقشِ اول سنجیده می‌شد و بقیه را exec می‌خورد (همان تلهٔ backup.sh).
  while IFS= read -r role <&3; do
    [ -n "$role" ] || continue
    total=$((total + 1))
    [ "$(psql_q -c "SELECT count(*) FROM pg_roles WHERE rolname = '${role//\'/\'\'}'")" = 1 ] || { miss=$((miss + 1)); bad "نقشِ «$role» برنگشت"; }
  done 3< <(grep -oE '^CREATE ROLE ("[^"]+"|[^ ;]+)' "$W/globals.sql" | sed -E 's/^CREATE ROLE //; s/^"//; s/"$//')
  if [ "$total" -gt 0 ] && [ "$miss" -eq 0 ]; then good "نقش‌ها برگشتند ($total نقش)"; elif [ "$total" -eq 0 ]; then good "نقشی جز ابرکاربر در پشتیبان نبود"; fi
  # نقشِ هر شرکت (`…_app`) باید بتواند وارد شود و رمز داشته باشد — وگرنه دیتابیس برگشته ولی برنامه به آن وصل نمی‌شود.
  weak="$(psql_q -c "SELECT coalesce(string_agg(rolname, ' '), '') FROM pg_authid WHERE rolname LIKE '%\\_app' AND (NOT rolcanlogin OR rolpassword IS NULL)" 2>/dev/null || echo '؟')"
  [ -z "$weak" ] || bad "نقشِ شرکت بی‌اجازهٔ ورود یا بی‌رمز برگشت: $weak"
fi

# ── ۳) دیتابیس‌ها ──
DUMPS=("$W"/*.dump)
[ "${#DUMPS[@]}" -gt 0 ] || bad "هیچ دامپِ دیتابیسی در پشتیبان نیست"
RESTORED=()
for f in "${DUMPS[@]}"; do
  db="$(basename "$f" .dump)"
  # `postgres` روی هر سروری از قبل هست؛ `--create` برایش «از قبل هست» می‌دهد — پس در همان دیتابیسِ (خالیِ) موجود.
  if [ "$db" = postgres ]; then restore=(pg_restore -U "$SU" -d postgres --exit-on-error); else restore=(pg_restore -U "$SU" -d postgres --create --exit-on-error); fi
  if pgx "${restore[@]}" < "$f" > "$W/$db.out" 2>&1; then
    RESTORED+=("$db"); good "دیتابیسِ $db برگشت"
  else
    bad "دیتابیسِ $db برنگشت"; tail -n 5 "$W/$db.out" | sed 's/^/        /'
  fi
done

# ── ۴) سازگاریِ دیتابیسِ مرکزی و شرکت‌ها ──
CONTROL=""; TENANT_DBS=()
declare -A DB_TENANT=()
printf '\n  %-26s %10s %10s %10s %10s\n' 'دیتابیس' 'migration' 'بیمار' 'مراجعه' 'مدرک'
for db in "${RESTORED[@]:-}"; do
  [ -n "$db" ] || continue
  has() { [ "$(psql_db "$db" -c "SELECT to_regclass('public.$1') IS NOT NULL")" = t ]; }
  cnt() { if has "$1"; then psql_db "$db" -c "SELECT count(*) FROM $1"; else echo -; fi; }
  mig="$(cnt _prisma_migrations)"; pat="$(cnt patients)"; vis="$(cnt visits)"; doc="$(cnt documents)"
  printf '  %-26s %10s %10s %10s %10s\n' "$db" "$mig" "$pat" "$vis" "$doc"
  if has tenants && has tenant_domains; then
    CONTROL="$db"
  elif has patients; then
    TENANT_DBS+=("$db")
    [ "$mig" != - ] && [ "$mig" -gt 0 ] 2>/dev/null || bad "دیتابیسِ $db هیچ migrationی ندارد (ساختارش ناقص برگشته)"
  fi
done
echo
if [ -z "$CONTROL" ]; then bad "دیتابیسِ مرکزی (جدولِ tenants) در پشتیبان نیست — بدونِ آن هیچ شرکتی پیدا نمی‌شود"
else
  # هر شرکتِ فعال ← دیتابیسِ خودش، نه «به تعدادِ کافی دیتابیس»: شمارش، دیتابیسِ شرکتِ حذف‌شده را جای شرکتِ گم‌شده می‌پذیرفت.
  # Worker نامِ دیتابیس را از شناسه می‌سازد (`amalyar_<شناسه با _>`). شرکتی که با نام پیدا نشد (ساخته‌شده پیش از Worker)
  # فقط با دیتابیسی پذیرفته می‌شود که نامِ Worker ندارد — `amalyar_*`ِ بی‌شرکت باقیماندهٔ شرکتِ حذف‌شده است.
  ACTIVE=0; BYNAME=0; LEFT=()
  if ! psql_db "$CONTROL" -v ON_ERROR_STOP=1 -F '|' -c "SELECT id, slug FROM tenants WHERE status = 'active' ORDER BY slug" > "$W/tenants.txt" 2> "$W/q.err"; then
    bad "فهرستِ شرکت‌ها از $CONTROL خوانده نشد: $(head -c 160 "$W/q.err")"
  fi
  while IFS='|' read -r tid slug <&3; do
    [ -n "$tid" ] || continue
    ACTIVE=$((ACTIVE + 1))
    want="amalyar_${slug//-/_}"
    if in_list "$want" "${TENANT_DBS[@]:-}"; then DB_TENANT[$want]="$tid"; BYNAME=$((BYNAME + 1)); else LEFT+=("$slug"); fi
  done 3< "$W/tenants.txt"
  SPARE=()
  for db in "${TENANT_DBS[@]:-}"; do
    [ -n "$db" ] && [ -z "${DB_TENANT[$db]:-}" ] || continue
    case "$db" in amalyar_*) warn "دیتابیسِ $db به هیچ شرکتِ فعالی نمی‌خورد (باقیماندهٔ شرکتِ حذف‌شده؟)";; *) SPARE+=("$db");; esac
  done
  good "دیتابیسِ مرکزی: $CONTROL ($ACTIVE شرکتِ فعال)"
  if [ "${#LEFT[@]}" -eq 0 ]; then good "دیتابیسِ همهٔ شرکت‌های فعال برگشت ($BYNAME از $ACTIVE، هرکدام با نامِ خودش)"
  elif [ "${#SPARE[@]}" -ge "${#LEFT[@]}" ]; then
    good "دیتابیسِ همهٔ شرکت‌های فعال برگشت ($BYNAME با نام، ${#LEFT[@]} قدیمی با شمارش)"
    warn "این شرکت‌ها نامِ دیتابیسِ Worker را ندارند و فقط با شمارش پذیرفته شدند: ${LEFT[*]} ← ${SPARE[*]}"
  else bad "دیتابیسِ این شرکت‌های فعال برنگشت: ${LEFT[*]}"; fi
fi

# ── ۵) فایل‌های ارجاع‌شده — هر شرکت در پوشهٔ خودش ──
# ⚠️ هر پرس‌وجو با ON_ERROR_STOP و خطایش «ناموفق» است: تا دیروز خطا قورت داده می‌شد، فهرستِ لازم خالی می‌ماند و تمرین
# «همهٔ ۰ فایل» را موفق اعلام می‌کرد. و پوشهٔ هر شرکت جدا سنجیده می‌شود (فایلِ هم‌محتوای شرکتِ دیگر جای فایلِ گم‌شده
# را پر نمی‌کند).
REFS=(
  "documents|SELECT DISTINCT sha256 FROM documents WHERE sha256 <> '' AND deleted_at IS NULL|required"
  "stop_proofs|SELECT DISTINCT sha256 FROM stop_proofs WHERE sha256 <> ''|required"
  "site_items|SELECT image_sha FROM site_items WHERE coalesce(image_sha, '') <> '' UNION SELECT image2_sha FROM site_items WHERE coalesce(image2_sha, '') <> ''|optional"
  "settings|SELECT value FROM settings WHERE key = 'letterhead_sha' AND coalesce(value, '') <> ''|optional"
)
if [ -f "$W/storage.tar.gz" ]; then
  tar -tzf "$W/storage.tar.gz" 2>/dev/null | sed 's|^\./||' | awk -F/ 'NF >= 2 && $NF ~ /^[0-9a-f]+$/ && length($NF) == 64 {print $1, $NF}' | sort -u > "$W/have.txt"
  ARCHIVED="$(wc -l < "$W/have.txt" | tr -d ' ')"
  NEED_TOTAL=0
  for db in "${TENANT_DBS[@]:-}"; do
    [ -n "$db" ] || continue
    : > "$W/need.raw"
    for ref in "${REFS[@]}"; do
      IFS='|' read -r t q kind <<< "$ref"
      if [ "$(psql_db "$db" -c "SELECT to_regclass('public.$t') IS NOT NULL")" != t ]; then
        [ "$kind" = optional ] || bad "در $db جدولِ $t نیست — ساختارش ناقص برگشته و ارجاع‌هایش سنجیده نشد"
        continue
      fi
      psql_db "$db" -v ON_ERROR_STOP=1 -c "$q" >> "$W/need.raw" 2> "$W/q.err" || bad "ارجاع‌های $db.$t خوانده نشد: $(head -c 160 "$W/q.err")"
    done
    grep -E '^[0-9a-f]{64}$' "$W/need.raw" | sort -u > "$W/need.txt"
    n="$(wc -l < "$W/need.txt" | tr -d ' ')"; NEED_TOTAL=$((NEED_TOTAL + n))
    [ "$n" -gt 0 ] || continue
    folder="${DB_TENANT[$db]:-}"
    # شرکتِ قدیمی (بی‌نامِ Worker): پوشه‌ای که بیشترین ارجاعِ همین دیتابیس را دارد.
    [ -n "$folder" ] || folder="$(awk 'NR == FNR { need[$1] = 1; next } need[$2] { c[$1]++ } END { for (f in c) print c[f], f }' "$W/need.txt" "$W/have.txt" | sort -rn | head -1 | cut -d' ' -f2)"
    awk -v f="$folder" '$1 == f { print $2 }' "$W/have.txt" | sort -u > "$W/have-db.txt"
    missing="$(comm -23 "$W/need.txt" "$W/have-db.txt" | wc -l | tr -d ' ')"
    if [ "$missing" -eq 0 ]; then good "همهٔ $n فایلِ ارجاع‌شدهٔ $db در پوشهٔ همان شرکت هست"
    else bad "$missing فایلِ ارجاع‌شدهٔ $db در پوشهٔ شرکتش نیست (نمونه: $(comm -23 "$W/need.txt" "$W/have-db.txt" | head -2 | cut -c1-12 | tr '\n' ' '))"; fi
  done
  if [ "$NEED_TOTAL" -eq 0 ] && [ "$ARCHIVED" -gt 0 ]; then
    warn "هیچ دیتابیسی به فایلی ارجاع نمی‌دهد ولی آرشیو $ARCHIVED فایل دارد — جای ارجاع‌ها در ساختار عوض شده؟ این سنجه چیزی را ثابت نکرد"
  fi
else
  warn "آرشیوِ فایل‌ها در پشتیبان نیست؛ ارجاع‌های فایل سنجیده نشد"
fi

ELAPSED=$(( $(date +%s) - START ))
echo
if [ "$FAILS" -eq 0 ] && [ "$WARNS" -eq 0 ]; then
  say "تمرین موفق — پشتیبانِ $(basename "$SRC") کامل برگشت (${ELAPSED} ثانیه، سرورِ تمرین دورریخته شد)"
  exit 0
fi
if [ "$FAILS" -eq 0 ]; then
  say "تمرین موفق با $WARNS هشدار — پشتیبانِ $(basename "$SRC") برگشت ولی بندهای «!» بالا را بخوان (${ELAPSED} ثانیه)"
  exit 0
fi
say "تمرین ناموفق — $FAILS مورد (${ELAPSED} ثانیه) — این پشتیبان را قابلِ اتکا نشمار"
exit 1
