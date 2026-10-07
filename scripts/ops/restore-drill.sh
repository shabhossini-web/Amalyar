#!/usr/bin/env bash
# تمرینِ بازگردانی — پشتیبان را در یک Postgresِ **تازه و دورریختنی** برمی‌گرداند و می‌سنجد که واقعاً برگشته است.
# پشتیبانی که هرگز بازگردانده نشده باشد، فقط یک فایل است؛ این اسکریپت همان «بازگردانی»ی شبِ فاجعه را از پیش، روی
# سرورِ دورریختنی، اجرا می‌کند. **هرگز به دیتابیسِ زنده دست نمی‌زند.**
#
# چه می‌سنجد (هر کدام شکست بخورد، کدِ خروجی غیرصفر و علتِ فارسی چاپ می‌شود):
#   ۱. چکیده‌ها (SHA256SUMS) — فایلِ دستکاری‌شده یا نیمه‌کاره
#   ۲. نقش‌ها (globals.sql) بدونِ خطا برمی‌گردند و هر نقشِ پشتیبان واقعاً ساخته می‌شود
#   ۳. هر دامپ بدونِ خطا برمی‌گردد (pg_restore --create، با همان مالکِ اصلی)
#   ۴. دیتابیسِ مرکزی (جدول tenants) در پشتیبان هست و دیتابیسِ هر شرکتِ فعال هم برگشته و migration دارد
#   ۵. هر فایلی که دیتابیس به آن ارجاع می‌دهد (documents.sha256، stop_proofs.sha256) در storage.tar.gz هست
# و در پایان شمارِ ردیف‌های هر شرکت و **زمانِ بازگردانی** را می‌گوید (همان «چقدر طول می‌کشد؟»ی شبِ فاجعه).
#
# اجرا روی میزبانِ سرور (Docker لازم است؛ یک کانتینرِ postgres:18-alpine موقت می‌سازد و در پایان پاک می‌کند):
#   sudo bash restore-drill.sh                    # آخرین پشتیبان در /var/backups/amalyar
#   sudo bash restore-drill.sh 20261007T020000Z   # یک پشتیبانِ مشخص (نام یا مسیر)
# اگر پشتیبان رمزشده بود: BACKUP_PASSPHRASE=… را هم بگذار.
#
# بدونِ Docker (آزمون): یک سرورِ **خالی** و دورریختنی را با PGHOST/PGPORT/PGUSER نشان بده و DRILL_LOCAL=yes بگذار؛
# اگر آن سرور جز postgres دیتابیسی داشته باشد اسکریپت می‌ایستد (مبادا روی سرورِ زنده بازگردانده شود).
set -uo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/amalyar}"
DRILL_IMAGE="${DRILL_IMAGE:-postgres:18-alpine}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-}"
DRILL_LOCAL="${DRILL_LOCAL:-}"
ARG="${1:-}"

say() { printf '%s\n' "$*"; }
FAILS=0
bad() { printf '  ✘ %s\n' "$*"; FAILS=$((FAILS + 1)); }
good() { printf '  ✔ %s\n' "$*"; }
die() { printf 'خطا: %s\n' "$*" >&2; exit 2; }

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
    SHA256SUMS|MANIFEST.txt|FAILED) continue;;
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
  while IFS= read -r role; do
    [ -n "$role" ] || continue
    total=$((total + 1))
    [ "$(psql_q -c "SELECT count(*) FROM pg_roles WHERE rolname = '${role//\'/\'\'}'")" = 1 ] || { miss=$((miss + 1)); bad "نقشِ «$role» برنگشت"; }
  done < <(grep -oE '^CREATE ROLE ("[^"]+"|[^ ;]+)' "$W/globals.sql" | sed -E 's/^CREATE ROLE //; s/^"//; s/"$//')
  if [ "$total" -gt 0 ] && [ "$miss" -eq 0 ]; then good "نقش‌ها برگشتند ($total نقش)"; elif [ "$total" -eq 0 ]; then good "نقشی جز ابرکاربر در پشتیبان نبود"; fi
fi

# ── ۳) دیتابیس‌ها ──
DUMPS=("$W"/*.dump)
[ "${#DUMPS[@]}" -gt 0 ] || bad "هیچ دامپِ دیتابیسی در پشتیبان نیست"
RESTORED=()
for f in "${DUMPS[@]}"; do
  db="$(basename "$f" .dump)"
  if pgx pg_restore -U "$SU" -d postgres --create --exit-on-error < "$f" > "$W/$db.out" 2>&1; then
    RESTORED+=("$db"); good "دیتابیسِ $db برگشت"
  else
    bad "دیتابیسِ $db برنگشت"; tail -n 5 "$W/$db.out" | sed 's/^/        /'
  fi
done

# ── ۴) سازگاریِ دیتابیسِ مرکزی و شرکت‌ها ──
CONTROL=""; ACTIVE=0; TENANT_DBS=()
printf '\n  %-26s %10s %10s %10s %10s\n' 'دیتابیس' 'migration' 'بیمار' 'مراجعه' 'مدرک'
for db in "${RESTORED[@]:-}"; do
  [ -n "$db" ] || continue
  has() { [ "$(psql_db "$db" -c "SELECT to_regclass('public.$1') IS NOT NULL")" = t ]; }
  cnt() { if has "$1"; then psql_db "$db" -c "SELECT count(*) FROM $1"; else echo -; fi; }
  mig="$(cnt _prisma_migrations)"; pat="$(cnt patients)"; vis="$(cnt visits)"; doc="$(cnt documents)"
  printf '  %-26s %10s %10s %10s %10s\n' "$db" "$mig" "$pat" "$vis" "$doc"
  if has tenants && has tenant_domains; then
    CONTROL="$db"; ACTIVE="$(psql_db "$db" -c "SELECT count(*) FROM tenants WHERE status = 'active'")"
  elif has patients; then
    TENANT_DBS+=("$db")
    [ "$mig" != - ] && [ "$mig" -gt 0 ] 2>/dev/null || bad "دیتابیسِ $db هیچ migrationی ندارد (ساختارش ناقص برگشته)"
  fi
done
echo
if [ -z "$CONTROL" ]; then bad "دیتابیسِ مرکزی (جدولِ tenants) در پشتیبان نیست — بدونِ آن هیچ شرکتی پیدا نمی‌شود"
else
  good "دیتابیسِ مرکزی: $CONTROL ($ACTIVE شرکتِ فعال)"
  if [ "${#TENANT_DBS[@]}" -ge "$ACTIVE" ]; then good "دیتابیسِ همهٔ شرکت‌های فعال برگشت (${#TENANT_DBS[@]} از $ACTIVE)"
  else bad "فقط ${#TENANT_DBS[@]} دیتابیسِ شرکت برگشت ولی $ACTIVE شرکتِ فعال هست"; fi
fi

# ── ۵) فایل‌های ارجاع‌شده ──
if [ -f "$W/storage.tar.gz" ]; then
  tar -tzf "$W/storage.tar.gz" 2>/dev/null | awk -F/ '{print $NF}' | grep -E '^[0-9a-f]{64}$' | sort -u > "$W/have.txt"
  : > "$W/need.txt"
  for db in "${TENANT_DBS[@]:-}"; do
    [ -n "$db" ] || continue
    for q in "documents:sha256:deleted_at IS NULL" "stop_proofs:sha256:true"; do
      IFS=: read -r t c w <<< "$q"
      [ "$(psql_db "$db" -c "SELECT to_regclass('public.$t') IS NOT NULL")" = t ] || continue
      psql_db "$db" -c "SELECT DISTINCT $c FROM $t WHERE $c <> '' AND $w" >> "$W/need.txt"
    done
  done
  sort -u -o "$W/need.txt" "$W/need.txt"
  missing="$(comm -23 "$W/need.txt" "$W/have.txt" | wc -l | tr -d ' ')"
  if [ "$missing" -eq 0 ]; then good "همهٔ $(wc -l < "$W/need.txt" | tr -d ' ') فایلِ ارجاع‌شده در آرشیوِ فایل‌ها هست"
  else bad "$missing فایلِ ارجاع‌شده در آرشیوِ فایل‌ها نیست (نمونه: $(comm -23 "$W/need.txt" "$W/have.txt" | head -2 | cut -c1-12 | tr '\n' ' '))"; fi
else
  say "  – آرشیوِ فایل‌ها در پشتیبان نیست؛ ارجاع‌های فایل سنجیده نشد"
fi

ELAPSED=$(( $(date +%s) - START ))
echo
if [ "$FAILS" -eq 0 ]; then
  say "تمرین موفق — پشتیبانِ $(basename "$SRC") کامل برگشت (${ELAPSED} ثانیه، سرورِ تمرین دورریخته شد)"
  exit 0
fi
say "تمرین ناموفق — $FAILS مورد (${ELAPSED} ثانیه) — این پشتیبان را قابلِ اتکا نشمار"
exit 1
