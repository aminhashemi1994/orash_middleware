#!/usr/bin/env bash
#
# نمایش بریده‌شدن کد ۲۱ رقمی کالا در CreateGood.
#
# ⚠ این اسکریپت یک کالای واقعی روی پایگاه تولید می‌سازد. هر بار که اجرا شود
#   یک کالای دیگر ساخته می‌شود که باید توسط حسابداری حذف شود. تنها راه دیدن
#   این ایراد همین است، چون بررسی کد بسته‌بندی آخرین مرحله قبل از ثبت است و
#   هیچ خطای عمدی‌ای نمی‌تواند جلوی ثبت را بگیرد و همزمان نتیجه را نشان دهد.
#
#   ./scripts/orash-code-truncation.sh
#
set -u

BASE="${ORASH_BASE_URL:-http://192.168.3.210:5000}"
PROD='44e66728-fea3-4fc9-b2bd-5ecb9bb893e2'
USER="${ORASH_USER:-آمنه اصیل}"
PASS="${ORASH_PASS:-Asil@@23043}"

# یک کد ۲۱ رقمی یکتا، تا به کد موجودی برخورد نکند
CODE="1124200000315064${RANDOM:0:1}$((RANDOM % 10))$((RANDOM % 10))$((RANDOM % 10))$((RANDOM % 10))"
CODE="${CODE:0:21}"
NAME="ZZ-TEST-CODE-LENGTH-$$"

echo "=== ۱) گرفتن توکن"
TOKEN=$(curl -s -m 30 -H 'Content-Type: application/json' -X POST "$BASE/api/Auth" \
  -d "{\"uniqueID\":\"$PROD\",\"username\":\"$USER\",\"password\":\"$PASS\"}" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -z "$TOKEN" ] && { echo "ورود ناموفق"; exit 1; }
echo "توکن گرفته شد (طول ${#TOKEN})"

echo
echo "=== ۲) ثبت کالا با کد ۲۱ رقمی"
echo "کد فرستاده‌شده: $CODE  (${#CODE} رقم)"
echo
curl -s -m 60 -w '\n[HTTP %{http_code}]\n' -X POST "$BASE/api/v3/Good/CreateGood" \
  -H 'Content-Type: application/json' \
  -H "Authorization: bearer $TOKEN" \
  -d "{
  \"uniqueID\": \"$PROD\",
  \"data\": {
    \"code\": \"$CODE\",
    \"name\": \"$NAME\",
    \"type\": 1,
    \"serial\": \"999999\",
    \"unitIdRef\": 5,
    \"mainGroupCodeRef\": 1,
    \"secondGroupCodeRef\": 45,
    \"lengthValue\": 250,
    \"isActive\": true
  }
}"

echo
echo "=== انتظار"
echo "پیام موفقیت باید همان کد ۲۱ رقمی بالا را برگرداند، ولی ۲۰ رقم برمی‌گرداند"
echo "(رقم آخر می‌افتد). نام کالای ساخته‌شده برای حذف: $NAME"
