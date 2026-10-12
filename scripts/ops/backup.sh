#!/usr/bin/env bash
# پشتیبانِ کاملِ عمل‌یار — همهٔ دیتابیس‌ها (مرکزی + هر شرکت) + نقش‌ها + پوشهٔ فایل‌های آپلودی.
#
# چرا همه‌چیز با هم: شرکتِ تازه دیتابیس و نقشِ تازه دارد و رمزِ نقش‌ها فقط در «نقش‌ها»ی Postgres و (رمزشده) در دیتابیسِ
# مرکزی است. پشتیبانی که فقط یک دیتابیس را بردارد یا نقش‌ها را نه، بعد از فاجعه نیمی از شرکت‌ها را برنمی‌گرداند — و
# فهرستِ دیتابیس‌های دستی با ساختنِ هر شرکتِ تازه کهنه می‌شود. این‌جا فهرست از خودِ Postgres خوانده می‌شود.
#
# چه می‌سازد (در $BACKUP_DIR/<زمانِ UTC>/):
#   globals.sql        نقش‌ها و رمزشان (pg_dumpall --globals-only)
#   <db>.dump          هر دیتابیس، قالبِ custom (pg_dump -Fc) — پیش از ذخیره با pg_restore --list خوانده‌شدنش سنجیده می‌شود
#                      (`postgres.dump` فقط وقتی دیتابیسِ پیش‌فرض جدول دارد — در نصبِ واقعی دیتابیسِ مرکزی همان‌جاست)
#   storage.tar.gz     پوشهٔ فایل‌ها (عکس و مدارک) — **بعد** از دیتابیس‌ها گرفته می‌شود تا هر فایلِ ارجاع‌شده در دامپ باشد
#                      (بدونِ `.ledger`: دفترِ کانتینرها اثباتِ ماندگاریِ همان volume است و با بازگردانی نباید منتقل شود)
#   MISSING_FILES.txt  (اگر لازم شد) فایل‌هایی که دیتابیس به آن‌ها ارجاع می‌دهد ولی همان لحظه روی سرور نبودند — «دیتابیس چکیده»
#   SHA256SUMS         چکیدهٔ همهٔ فایل‌ها — تمرینِ بازگردانی اول همین را می‌سنجد
#   MANIFEST.txt       خلاصهٔ قابلِ‌خواندن
# و فایلِ LATEST در $BACKUP_DIR که نامِ آخرین پوشه را دارد. اگر چیزی شکست بخورد فایلِ FAILED کنارِ آن پوشه می‌نشیند
# و کد خروجی غیرصفر است (برای اعلانِ cron).
#
# اجرا روی میزبانِ سرور (کنارِ Docker/Coolify):
#   sudo bash backup.sh                      # Postgres و volume خودکار پیدا می‌شوند
#   PG_CONTAINER=… STORAGE_VOLUME=… BACKUP_DIR=/mnt/backup bash backup.sh
# بدونِ Docker (توسعه/آزمون): PGHOST/PGPORT/PGUSER را بگذار و STORAGE_DIR=/مسیر/پوشهٔ/فایل‌ها.
#
# متغیرها:
#   BACKUP_DIR          پیش‌فرض /var/backups/amalyar
#   RETENTION_DAYS      پیش‌فرض ۱۴ (دست‌کم سه پوشهٔ تازه همیشه می‌ماند)
#   PG_CONTAINER        نامِ کانتینرِ Postgres؛ خالی = تنها کانتینرِ postgres:* یا کلاینتِ محلیِ PG*
#   PG_USER             ابرکاربر؛ پیش‌فرض POSTGRES_USER داخلِ کانتینر یا PGUSER یا postgres
#   STORAGE_VOLUME      نامِ volumeِ فایل‌ها؛ خالی = تنها volumeای که نامش به «storage» ختم می‌شود
#   STORAGE_DIR         به‌جای volume، یک پوشهٔ معمولی
#   SKIP_STORAGE=1      فقط دیتابیس (پیش‌فرض: نبودنِ فایل‌ها خطاست، نه هشدار)
#   BACKUP_PASSPHRASE   اگر پر باشد همهٔ فایل‌ها با AES-256 رمز می‌شوند (پسوندِ .enc) — برای بیرون‌بردن از سرور
#   RCLONE_REMOTE       مثلاً arvan:amalyar-backups — اگر rclone نصب باشد پس از موفقیت همان پوشه آپلود می‌شود
#   BACKUP_ENV          فایلِ تنظیمات؛ پیش‌فرض /etc/amalyar-backup.env (اگر باشد). هر خط «کلید=مقدار» از همین متغیرها؛
#                       **مثلِ شل تفسیر نمی‌شود** ($، `، فاصله و # در مقدار همان‌طور می‌مانند؛ یک جفت ' یا " دورش برداشته
#                       می‌شود). کلیدِ ناشناخته خطاست (غلطِ تایپی بی‌صدا نماند). متغیرِ محیطی بر فایل مقدم است.
#
# کدِ خروجی: ۰ موفق · ۱ پشتیبان ناقص (FAILED کنارِ پوشه) · ۳ پشتیبانِ محلی کامل ولی آپلودِ بیرونی نشد (UPLOAD_FAILED).
set -euo pipefail
# دامپِ دیتابیس مدرکِ بیمار است: پوشه‌ها ۰۷۰۰ و فایل‌ها ۰۶۰۰ — کاربرِ دیگرِ سرور نباید بتواند بخواندشان.
umask 077

say() { printf '%s\n' "$*"; }
die() { printf 'خطا: %s\n' "$*" >&2; exit 1; }

# ── فایلِ تنظیمات: خواندنِ متنیِ «کلید=مقدار»، نه `source` ──
# ⚠️ `. /etc/amalyar-backup.env` رمزی با $ یا ` یا فاصله را هنگامِ خواندن عوض می‌کرد؛ cron با رشتهٔ دیگری رمز می‌کرد
# و پشتیبان با رمزی که مالک نگه داشته بود باز نمی‌شد. این‌جا مقدار هرگز به شل داده نمی‌شود.
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
    if [ "${#val}" -ge 2 ]; then
      case "$val" in \'*\') val="${val:1:${#val}-2}";; \"*\") val="${val:1:${#val}-2}";; esac
    fi
    [ -n "${!key+x}" ] || printf -v "$key" '%s' "$val"
  done < "$f"
}
load_env "${BACKUP_ENV:-/etc/amalyar-backup.env}"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/amalyar}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PG_CONTAINER="${PG_CONTAINER:-}"
STORAGE_VOLUME="${STORAGE_VOLUME:-}"
STORAGE_DIR="${STORAGE_DIR:-}"
SKIP_STORAGE="${SKIP_STORAGE:-}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

# ابزارِ Postgres: داخلِ کانتینر (نسخهٔ هم‌خوانِ سرور) یا کلاینتِ محلی.
pgx() { if [ -n "$PG_CONTAINER" ]; then docker exec -i "$PG_CONTAINER" "$@"; else "$@"; fi; }

# ── کانتینرِ Postgres ──
if [ -z "$PG_CONTAINER" ] && [ -z "${PGHOST:-}" ]; then
  command -v docker >/dev/null 2>&1 || die "Docker پیدا نشد؛ یا PG_CONTAINER بده یا PGHOST/PGPORT/PGUSER را برای کلاینتِ محلی"
  # ⚠️ Coolify دیتابیسِ خودش را هم دارد (`coolify-db`، postgres:15) — همان Postgresی که داده‌های عمل‌یار رویش نیست.
  # بی‌این فیلتر روی هر میزبانِ Coolify دو کانتینر پیدا می‌شد و پشتیبانِ شبانه هر شب بی‌صدا می‌افتاد.
  found="$(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /^(postgres|pgvector)/ && $1 !~ /^coolify/ {print $1}')"
  [ "$(printf '%s\n' "$found" | grep -c .)" = 1 ] || die "کانتینرِ Postgres را نتوانستم یکتا پیدا کنم (${found:-هیچ}); PG_CONTAINER را در فایلِ تنظیمات بگذار"
  PG_CONTAINER="$found"
fi
if [ -n "$PG_CONTAINER" ]; then
  PG_USER="${PG_USER:-$(docker exec "$PG_CONTAINER" printenv POSTGRES_USER 2>/dev/null || true)}"
fi
PG_USER="${PG_USER:-${PGUSER:-postgres}}"
psql_q() { pgx psql -U "$PG_USER" -d postgres -X -qAt -v ON_ERROR_STOP=1 "$@"; }

[ "$(psql_q -c 'SELECT 1' 2>/dev/null || true)" = 1 ] || die "به Postgres وصل نشدم (کانتینر «${PG_CONTAINER:-محلی}»، کاربر «$PG_USER»)"

# ── پوشهٔ خروجی ──
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/$STAMP"
mkdir -p "$BACKUP_DIR"
# دو پشتیبانِ هم‌زمان (cron که هنوز تمام نشده) روی هم دامپ می‌نویسند و دیسک را پر می‌کنند.
if command -v flock >/dev/null 2>&1; then
  exec 9> "$BACKUP_DIR/.lock"
  flock -n 9 || die "پشتیبانِ دیگری هنوز در حال اجراست"
fi
mkdir -p "$OUT"
TMP="$(mktemp -d "$BACKUP_DIR/.tmp.XXXXXX")"
# FAILED فقط وقتی پشتیبانِ **محلی** کامل نشده؛ شکستِ آپلودِ بیرونی پس از آن پوشهٔ سالم را «ناقص» علامت نمی‌زند.
LOCAL_DONE=""
trap 'rc=$?; rm -rf "$TMP"; if [ $rc -ne 0 ] && [ -z "$LOCAL_DONE" ]; then echo "پشتیبان ناقص ماند (کد $rc)" > "$OUT/FAILED"; printf "خطا: پشتیبان کامل نشد — %s\n" "$OUT/FAILED" >&2; fi' EXIT

EXT=""
enc() { if [ -n "$BACKUP_PASSPHRASE" ]; then openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE; else cat; fi; }
[ -z "$BACKUP_PASSPHRASE" ] || { EXT=".enc"; command -v openssl >/dev/null 2>&1 || die "openssl برای رمزکردن لازم است"; export BACKUP_PASSPHRASE; }

PG_VERSION="$(psql_q -c 'SHOW server_version')"
say "پشتیبان‌گیری — Postgres $PG_VERSION → $OUT"

# ── نقش‌ها ──
pgx pg_dumpall -U "$PG_USER" --globals-only > "$TMP/globals.sql"
grep -q 'CREATE ROLE\|ALTER ROLE' "$TMP/globals.sql" || die "خروجیِ نقش‌ها خالی است"
enc < "$TMP/globals.sql" > "$OUT/globals.sql$EXT"
say "  ✔ نقش‌ها"

# ── دیتابیس‌ها: فهرست از خودِ Postgres ──
DBS="$(psql_q -c "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY 1")"
# ⚠️ دیتابیسِ پیش‌فرضِ `postgres` معمولاً خالی است، ولی در نصبِ واقعی **دیتابیسِ مرکزی همان‌جاست** (Coolify آن را
# «Initial DB» ساخت و CONTROL_DATABASE_URL به `/postgres` اشاره می‌کند). پشتیبانِ اولِ مالک هشت شرکت را گرفت و همین را
# جا انداخت — بی‌آن، پس از خرابی برنامه نمی‌داند هر نشانی به کدام دیتابیس وصل است. پس اگر جدولی دارد گرفته می‌شود.
PG_TABLES="$(pgx psql -U "$PG_USER" -d postgres -X -qAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')")"
NL=$'\n'
if [ "${PG_TABLES:-0}" -gt 0 ] 2>/dev/null; then DBS="postgres${DBS:+$NL$DBS}"; fi
[ -n "$DBS" ] || die "هیچ دیتابیسی (به‌جز postgres) پیدا نشد"
COUNT=0
# ⚠️ فهرست از fd 3 خوانده می‌شود: `docker exec -i` ورودیِ استاندارد را می‌بلعد و نامِ دیتابیس‌های بعدی را می‌خورد.
while IFS= read -r db <&3; do
  [ -n "$db" ] || continue
  case "$db" in *[!A-Za-z0-9_-]*) die "نامِ دیتابیسِ نامنتظر: $db";; esac
  pgx pg_dump -U "$PG_USER" -Fc -d "$db" > "$TMP/$db.dump"
  # دامپی که بازخوانده نشود دامپ نیست — همین‌جا، نه شبِ فاجعه.
  pgx pg_restore --list < "$TMP/$db.dump" > /dev/null || die "دامپِ $db بازخوانی نشد"
  enc < "$TMP/$db.dump" > "$OUT/$db.dump$EXT"
  size="$(psql_q -c "SELECT pg_size_pretty(pg_database_size('$db'))")"
  say "  ✔ $db ($size)"
  COUNT=$((COUNT + 1))
done 3<<< "$DBS"

# ── فایل‌ها: بعد از دیتابیس‌ها ──
STORAGE_NOTE="رد شد (SKIP_STORAGE)"
if [ -z "$SKIP_STORAGE" ]; then
  if [ -n "$STORAGE_DIR" ]; then
    [ -d "$STORAGE_DIR" ] || die "پوشهٔ فایل‌ها پیدا نشد: $STORAGE_DIR"
    # `.ledger` (دفترِ کانتینرهای برنامه) عمداً بیرون می‌ماند: اگر همراهِ فایل‌ها برگردد، volumeِ تازه با اثباتِ ماندگاریِ
    # volumeِ قبلی «ماندگار» نشان داده می‌شد؛ بدونِ آن، بعد از بازگردانی اثبات از صفر و با دیپلویِ بعدی شروع می‌شود.
    tar -C "$STORAGE_DIR" --exclude=./.ledger -czf "$TMP/storage.tar.gz" .
  else
    command -v docker >/dev/null 2>&1 || die "برای پشتیبانِ volume به Docker نیاز است؛ یا STORAGE_DIR بده یا SKIP_STORAGE=1"
    if [ -z "$STORAGE_VOLUME" ]; then
      vols="$(docker volume ls --format '{{.Name}}' | grep -E 'storage$' || true)"
      [ "$(printf '%s\n' "$vols" | grep -c .)" = 1 ] || die "volumeِ فایل‌ها را یکتا پیدا نکردم (${vols:-هیچ}); STORAGE_VOLUME را بگذار"
      STORAGE_VOLUME="$vols"
    fi
    docker volume inspect "$STORAGE_VOLUME" >/dev/null 2>&1 || die "volume پیدا نشد: $STORAGE_VOLUME"
    docker run --rm -v "$STORAGE_VOLUME":/data:ro alpine tar -C /data --exclude=./.ledger -czf - . > "$TMP/storage.tar.gz"
  fi
  tar -tzf "$TMP/storage.tar.gz" > /dev/null || die "آرشیوِ فایل‌ها خوانده نشد"
  FILES="$(tar -tzf "$TMP/storage.tar.gz" | grep -vc '/$' || true)"
  enc < "$TMP/storage.tar.gz" > "$OUT/storage.tar.gz$EXT"
  STORAGE_NOTE="${FILES} فایل، $(du -h "$OUT/storage.tar.gz$EXT" | cut -f1)"
  say "  ✔ فایل‌ها ($STORAGE_NOTE)"

  # ── فایل‌هایی که دیتابیس به آن‌ها ارجاع می‌دهد ولی **همین الان** روی سرور نیستند ──
  # اولین تمرینِ واقعی (۱۴۰۵/۰۷/۲۰) ۲۴ مدرک را «نیست» گفت که پیش از ماندگارشدنِ پوشهٔ فایل‌ها با یک دیپلوی پاک شده بودند.
  # آرشیو عینِ پوشهٔ سرور است، پس تمرین به‌تنهایی نمی‌تواند «از قبل نبود» را از «در پشتیبان جا ماند» جدا کند و تا آپلودِ
  # دوبارهٔ همهٔ آن‌ها همیشه قرمز می‌ماند — و جاماندنِ واقعیِ یک فایل زیرِ همان قرمز گم می‌شد. پس همین‌جا، با همان قاعدهٔ
  # تمرین (شرکت ← پوشهٔ شناسه‌اش؛ چهار منبعِ ارجاع)، فهرستِ «از قبل نبود» در MISSING_FILES.txt ثبت می‌شود (فقط نامِ دیتابیس
  # و چکیدهٔ فایل — نه دادهٔ بیمار) و تمرین آن‌ها را هشدار می‌گوید، نه ناموفق.
  tar -tzf "$TMP/storage.tar.gz" | sed 's|^\./||' | awk -F/ 'NF >= 2 && $NF ~ /^[0-9a-f]+$/ && length($NF) == 64 {print $1, $NF}' | sort -u > "$TMP/have.txt"
  psql_in() { local d="$1"; shift; pgx psql -U "$PG_USER" -d "$d" -X -qAt -v ON_ERROR_STOP=1 "$@" < /dev/null; }
  has_table() { [ "$(psql_in "$1" -c "SELECT to_regclass('public.$2') IS NOT NULL")" = t ]; }
  declare -A TENANT_OF=()
  for db in $DBS; do
    if has_table "$db" tenants && has_table "$db" tenant_domains; then
      psql_in "$db" -F '|' -c "SELECT id, slug FROM tenants WHERE status = 'active'" > "$TMP/tenants.txt"
      while IFS='|' read -r tid slug <&3; do [ -n "$tid" ] && TENANT_OF["amalyar_${slug//-/_}"]="$tid"; done 3< "$TMP/tenants.txt"
    fi
  done
  : > "$TMP/MISSING_FILES.txt"
  for db in $DBS; do
    has_table "$db" patients || continue
    {
      has_table "$db" documents && psql_in "$db" -c "SELECT DISTINCT sha256 FROM documents WHERE sha256 <> '' AND deleted_at IS NULL"
      has_table "$db" stop_proofs && psql_in "$db" -c "SELECT DISTINCT sha256 FROM stop_proofs WHERE sha256 <> ''"
      has_table "$db" site_items && psql_in "$db" -c "SELECT image_sha FROM site_items WHERE coalesce(image_sha, '') <> '' UNION SELECT image2_sha FROM site_items WHERE coalesce(image2_sha, '') <> ''"
      has_table "$db" settings && psql_in "$db" -c "SELECT value FROM settings WHERE key = 'letterhead_sha' AND coalesce(value, '') <> ''"
    } | grep -E '^[0-9a-f]{64}$' | sort -u > "$TMP/need.txt" || true
    [ -s "$TMP/need.txt" ] || continue
    folder="${TENANT_OF[$db]:-}"
    [ -n "$folder" ] || folder="$(awk 'NR == FNR { need[$1] = 1; next } need[$2] { c[$1]++ } END { for (f in c) print c[f], f }' "$TMP/need.txt" "$TMP/have.txt" | sort -rn | head -1 | cut -d' ' -f2)"
    awk -v f="$folder" '$1 == f { print $2 }' "$TMP/have.txt" | sort -u > "$TMP/have-db.txt"
    comm -23 "$TMP/need.txt" "$TMP/have-db.txt" | sed "s/^/$db /" >> "$TMP/MISSING_FILES.txt"
  done
  ABSENT="$(wc -l < "$TMP/MISSING_FILES.txt" | tr -d ' ')"
  if [ "$ABSENT" -gt 0 ]; then
    cp "$TMP/MISSING_FILES.txt" "$OUT/MISSING_FILES.txt"
    STORAGE_NOTE="$STORAGE_NOTE؛ $ABSENT فایلِ ارجاع‌شده از قبل روی سرور نبود"
    say "  ! $ABSENT فایلِ ارجاع‌شده همین الان روی سرور نیست (پیش از این پشتیبان از دست رفته؛ باید دوباره آپلود شود) — MISSING_FILES.txt"
    cut -d' ' -f1 "$TMP/MISSING_FILES.txt" | sort | uniq -c | while read -r n d; do say "      $d: $n"; done
  fi
fi

# ── چکیده و خلاصه ──
( cd "$OUT" && sha256sum -- * > "$TMP/SHA256SUMS" && mv "$TMP/SHA256SUMS" SHA256SUMS )
{
  echo "عمل‌یار — پشتیبان $STAMP"
  echo "Postgres: $PG_VERSION"
  echo "دیتابیس‌ها ($COUNT): $(printf '%s' "$DBS" | tr '\n' ' ')"
  echo "فایل‌ها: $STORAGE_NOTE"
  if [ -n "$EXT" ]; then echo "رمزشده: بله"; else echo "رمزشده: خیر"; fi
} > "$OUT/MANIFEST.txt"
echo "$STAMP" > "$BACKUP_DIR/LATEST"
# برای سنجشِ تازگی: «آخرین پشتیبانِ موفق کِی بود؟» — `cat /var/backups/amalyar/LAST_SUCCESS`
echo "$STAMP $(date -u '+%Y-%m-%d %H:%M UTC')" > "$BACKUP_DIR/LAST_SUCCESS"
LOCAL_DONE=1
say "  ✔ چکیده‌ها و خلاصه"

# ── نگهداری: پوشه‌های قدیمی‌تر از RETENTION_DAYS، ولی همیشه سه‌تای تازه می‌مانند ──
# پیش از آپلود: شکستِ شبکه نباید جلوی پاک‌شدنِ پوشه‌های قدیمی را بگیرد و دیسک را شب‌به‌شب پر کند.
# ⚠️ فهرستِ null-جداشده، نه `for d in $(ls …)`: اگر BACKUP_DIR فاصله داشت، شکستنِ کلمه‌ها یک مسیرِ دیگر را به `rm -rf` می‌داد.
n=0
while IFS= read -r -d '' d; do
  n=$((n + 1))
  [ "$n" -gt 3 ] || continue
  if [ -n "$(find "$d" -maxdepth 0 -mtime +"$RETENTION_DAYS" 2>/dev/null)" ]; then rm -rf -- "$d"; say "  – پاک شد (قدیمی): $(basename "$d")"; fi
done < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*T*Z' -print0 | sort -z -r)

# ── آپلودِ بیرونی (اختیاری) ──
# شکستش پشتیبانِ محلیِ سالم را «ناقص» نمی‌کند (LATEST همان می‌ماند)، ولی بی‌صدا هم نیست: UPLOAD_FAILED کنارِ پوشه،
# LAST_UPLOAD_FAILED کنارِ LATEST و کدِ خروجیِ ۳ تا cron/پایش ببیند.
if [ -n "$RCLONE_REMOTE" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "rclone نصب نیست" > "$OUT/UPLOAD_FAILED"; echo "$STAMP" > "$BACKUP_DIR/LAST_UPLOAD_FAILED"
    printf 'خطا: RCLONE_REMOTE گذاشته‌ای ولی rclone نصب نیست — پشتیبانِ محلی کامل است: %s\n' "$OUT" >&2; exit 3
  fi
  if ! rclone copy "$OUT" "$RCLONE_REMOTE/$STAMP"; then
    echo "آپلود به $RCLONE_REMOTE شکست خورد" > "$OUT/UPLOAD_FAILED"; echo "$STAMP" > "$BACKUP_DIR/LAST_UPLOAD_FAILED"
    printf 'خطا: آپلود با rclone شکست خورد — پشتیبانِ محلی کامل است: %s\n' "$OUT" >&2; exit 3
  fi
  rm -f "$BACKUP_DIR/LAST_UPLOAD_FAILED"
  say "  ✔ آپلود به $RCLONE_REMOTE/$STAMP"
fi

say "تمام شد: $OUT"
