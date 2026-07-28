#!/usr/bin/env python3
"""
استخراجِ کتابِ ارزش نسبیِ خدماتِ سلامت از فایلِ اکسلِ رسمی.

خروجی: service-codes.json که در repo commit می‌شود و هنگامِ راه‌اندازیِ هر شرکت
seed می‌گردد. عمداً محصولِ ساخته‌شده را commit می‌کنیم نه خودِ اکسل را: اکسل
سالی یک‌بار عوض می‌شود و نتیجهٔ استخراج باید قابلِ بازبینی در diff باشد.

اجرا:  python3 extract-service-codes.py <فایل.xlsx> <سال>
"""
import json
import re
import sys
import warnings

import openpyxl

warnings.filterwarnings('ignore')

SHEET = 'RVU V4-Final'
HEADER_ROW = 3  # سطر ۴ به بعد داده است

# «ارزش تام N واحد» در ستونِ بیهوشی یعنی مقدارِ مقطوع، نه محاسبه‌شده.
FLAT_ANESTHESIA = re.compile(r'ارزش\s*تام\s*(\d+)\s*واحد')


def milli(value):
    """
    ارزشِ نسبی در هزارم‌واحد.

    عدد صحیح است نه اعشاری: در کلِ کتاب بیشترین دقت سه رقم است و ×۱۰۰۰ دقیقاً
    صحیح می‌شود، پس جمعِ صدها ردیفِ فاکتور هیچ خطای شناور نمی‌گیرد.
    """
    if value is None or value == '':
        return None
    if isinstance(value, (int, float)):
        return round(float(value) * 1000)
    return None


def anesthesia(value):
    """(مقدار، آیا مقطوع است)"""
    if isinstance(value, (int, float)):
        return milli(value), False
    if isinstance(value, str):
        hit = FLAT_ANESTHESIA.search(value)
        if hit:
            return int(hit.group(1)) * 1000, True
    return None, False


def main(path, year):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows = [
        r for r in wb[SHEET].iter_rows(min_row=HEADER_ROW + 1, values_only=True)
        if r[0] and str(r[0]).strip().isdigit()
    ]

    out, seen = [], set()
    for r in rows:
        code = str(r[0]).strip()
        if code in seen:
            raise SystemExit(f'کدِ تکراری: {code}')
        seen.add(code)

        title = ' '.join(str(r[2] or '').split())
        if not title:
            raise SystemExit(f'کدِ بدونِ شرح: {code}')

        total, professional, technical = milli(r[4]), milli(r[5]), milli(r[6])
        anes, anes_flat = anesthesia(r[7])

        # ثابتِ کتاب: ارزشِ کل = جزء حرفه‌ای + جزء فنی. اگر نقض شود یعنی
        # ستون‌ها جابه‌جا خوانده شده‌اند و بی‌سروصدا رد شدن از آن خطرناک است.
        if None not in (total, professional, technical) and total != professional + technical:
            raise SystemExit(f'کد {code}: کل({total}) ≠ حرفه‌ای({professional})+فنی({technical})')

        out.append([
            code,
            title,
            ' '.join(str(r[3] or '').split()) or None,   # توضیحات
            (str(r[1] or '').strip() or None),           # ویژگی: + * # ترکیب‌ها
            total, professional, technical, anes,
            1 if anes_flat else 0,
        ])

    payload = {
        'version': str(year),
        'source': 'کتاب ارزش نسبی خدمات سلامت',
        # آرایه‌ای به‌جای شیء: ۶۰۰۰ ردیف با کلیدهای تکراری فایل را سه برابر می‌کند.
        'fields': ['code', 'title', 'notes', 'modifier',
                   'rvuTotal', 'rvuProfessional', 'rvuTechnical', 'rvuAnesthesia', 'anesthesiaFlat'],
        'rows': out,
    }
    dest = f'{sys.path[0]}/service-codes.json'
    with open(dest, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(out)} کد → {dest}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
