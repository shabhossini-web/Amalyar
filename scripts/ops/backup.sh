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
#   storage.tar.gz     پوشهٔ فایل‌ها (عکس و مدارک) — **بعد** از دیتابیس‌ها گرفته می‌شود تا هر فایلِ ارجاع‌شده در دامپ باشد
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
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/amalyar}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PG_CONTAINER="${PG_CONTAINER:-}"
STORAGE_VOLUME="${STORAGE_VOLUME:-}"
STORAGE_DIR="${STORAGE_DIR:-}"
SKIP_STORAGE="${SKIP_STORAGE:-}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

say() { printf '%s\n' "$*"; }
die() { printf 'خطا: %s\n' "$*" >&2; exit 1; }

# ابزارِ Postgres: داخلِ کانتینر (نسخهٔ هم‌خوانِ سرور) یا کلاینتِ محلی.
pgx() { if [ -n "$PG_CONTAINER" ]; then docker exec -i "$PG_CONTAINER" "$@"; else "$@"; fi; }

# ── کانتینرِ Postgres ──
if [ -z "$PG_CONTAINER" ] && [ -z "${PGHOST:-}" ]; then
  command -v docker >/dev/null 2>&1 || die "Docker پیدا نشد؛ یا PG_CONTAINER بده یا PGHOST/PGPORT/PGUSER را برای کلاینتِ محلی"
  found="$(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /^(postgres|pgvector)/ {print $1}')"
  [ "$(printf '%s\n' "$found" | grep -c .)" = 1 ] || die "کانتینرِ Postgres را نتوانستم یکتا پیدا کنم (${found:-هیچ}); PG_CONTAINER را بگذار"
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
trap 'rc=$?; rm -rf "$TMP"; if [ $rc -ne 0 ]; then echo "پشتیبان ناقص ماند (کد $rc)" > "$OUT/FAILED"; printf "خطا: پشتیبان کامل نشد — %s\n" "$OUT/FAILED" >&2; fi' EXIT

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
    tar -C "$STORAGE_DIR" -czf "$TMP/storage.tar.gz" .
  else
    command -v docker >/dev/null 2>&1 || die "برای پشتیبانِ volume به Docker نیاز است؛ یا STORAGE_DIR بده یا SKIP_STORAGE=1"
    if [ -z "$STORAGE_VOLUME" ]; then
      vols="$(docker volume ls --format '{{.Name}}' | grep -E 'storage$' || true)"
      [ "$(printf '%s\n' "$vols" | grep -c .)" = 1 ] || die "volumeِ فایل‌ها را یکتا پیدا نکردم (${vols:-هیچ}); STORAGE_VOLUME را بگذار"
      STORAGE_VOLUME="$vols"
    fi
    docker volume inspect "$STORAGE_VOLUME" >/dev/null 2>&1 || die "volume پیدا نشد: $STORAGE_VOLUME"
    docker run --rm -v "$STORAGE_VOLUME":/data:ro alpine tar -C /data -czf - . > "$TMP/storage.tar.gz"
  fi
  tar -tzf "$TMP/storage.tar.gz" > /dev/null || die "آرشیوِ فایل‌ها خوانده نشد"
  FILES="$(tar -tzf "$TMP/storage.tar.gz" | grep -vc '/$' || true)"
  enc < "$TMP/storage.tar.gz" > "$OUT/storage.tar.gz$EXT"
  STORAGE_NOTE="${FILES} فایل، $(du -h "$OUT/storage.tar.gz$EXT" | cut -f1)"
  say "  ✔ فایل‌ها ($STORAGE_NOTE)"
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
say "  ✔ چکیده‌ها و خلاصه"

# ── آپلودِ بیرونی (اختیاری) ──
if [ -n "$RCLONE_REMOTE" ]; then
  command -v rclone >/dev/null 2>&1 || die "RCLONE_REMOTE گذاشته‌ای ولی rclone نصب نیست"
  rclone copy "$OUT" "$RCLONE_REMOTE/$STAMP" || die "آپلود با rclone شکست خورد"
  say "  ✔ آپلود به $RCLONE_REMOTE/$STAMP"
fi

# ── نگهداری: پوشه‌های قدیمی‌تر از RETENTION_DAYS، ولی همیشه سه‌تای تازه می‌مانند ──
n=0
for d in $(ls -1d "$BACKUP_DIR"/[0-9]*T*Z 2>/dev/null | sort -r); do
  n=$((n + 1))
  [ "$n" -gt 3 ] || continue
  if [ -n "$(find "$d" -maxdepth 0 -mtime +"$RETENTION_DAYS" 2>/dev/null)" ]; then rm -rf "$d"; say "  – پاک شد (قدیمی): $(basename "$d")"; fi
done

say "تمام شد: $OUT"
