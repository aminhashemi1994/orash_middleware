#!/usr/bin/env bash
#
# Reproduces, one by one, every fault we hit on the Orash web service.
# Read-only: it logs in and calls Get*/Search* only. The two CreateGood calls
# at the end deliberately use a uniqueID that matches no database, so the model
# binder answers while the controller can never reach a real one — nothing is
# ever created.
#
#   ./scripts/orash-bugs.sh
#
# هر بخش را جداگانه می‌توانید اجرا و خروجی‌اش را به پشتیبانی اوراش بدهید.

set -u

BASE="${ORASH_BASE_URL:-http://192.168.3.210:5000}"
PROD='44e66728-fea3-4fc9-b2bd-5ecb9bb893e2'      # Orash - شرکت توسعه صنایع سیم و کابل توس الکتریک
BOGUS='00000000-0000-0000-0000-000000000001'     # هیچ دیتابیسی با این شناسه وجود ندارد
USER="${ORASH_USER:-آمنه اصیل}"
PASS="${ORASH_PASS:-Asil@@23043}"

hr() { printf '\n=== %s\n' "$1"; }
api() { curl -s -m 60 -w '\n[HTTP %{http_code}]\n' -H 'Content-Type: application/json' "$@"; }

hr '0) فهرست دیتابیس‌ها (بدون توکن) — برای اینکه معلوم باشد روی کدام سرور تست شده'
curl -s -m 30 "$BASE/api/Install/GetDatabasesInfo"; echo

hr '0b) ورود و گرفتن توکن'
TOKEN=$(curl -s -m 30 -H 'Content-Type: application/json' -X POST "$BASE/api/Auth" \
  -d "{\"uniqueID\":\"$PROD\",\"username\":\"$USER\",\"password\":\"$PASS\"}" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ]; then echo "ورود ناموفق — بقیه‌ی تست‌ها اجرا نمی‌شود"; exit 1; fi
echo "ورود موفق (طول توکن: ${#TOKEN})"
AUTH="Authorization: bearer $TOKEN"

hr '1) GetGoods کاملاً از کار افتاده — خطای SQL: SearchGoods has too many arguments specified'
api -X POST "$BASE/api/v3/Good/GetGoods" -H "$AUTH" -d "{
  \"uniqueID\": \"$PROD\",
  \"data\": { \"showStockFlg\": 0, \"flagDepartment\": true, \"fromDepartment\": 0,
              \"toDepartment\": 0, \"currentUserId\": 10, \"withFi\": false }
}"

hr '1b) همان خطا حتی با data خالی — یعنی به ورودی ما ربطی ندارد'
api -X POST "$BASE/api/v3/Good/GetGoods" -H "$AUTH" -d "{\"uniqueID\":\"$PROD\",\"data\":{}}"

hr '2) نوع showStockFlg با مستندات نمی‌خواند: PDF می‌گوید bool، سرویس Int64 می‌خواهد'
api -X POST "$BASE/api/v3/Good/GetGoods" -H "$AUTH" -d "{
  \"uniqueID\": \"$PROD\",
  \"data\": { \"showStockFlg\": false, \"flagDepartment\": true, \"fromDepartment\": 0,
              \"toDepartment\": 0, \"currentUserId\": 10, \"withFi\": false }
}"
echo '   ^ توجه: خطا به فیلدی به نام goodSearch نسبت داده می‌شود که اصلاً در مستندات نیست'

hr '3) هیچ currentUserId معتبری وجود ندارد — پاسخ HTTP 200 است ولی محتوا خطاست'
for ID in 0 5 10; do
  echo "--- userId=$ID"
  api -X POST "$BASE/api/v3/Storage/GetStorages"    -H "$AUTH" -d "{\"uniqueID\":\"$PROD\",\"data\":{\"userId\":$ID,\"currentUserId\":$ID}}"
  api -X POST "$BASE/api/v3/Department/GetDepartments" -H "$AUTH" -d "{\"uniqueID\":\"$PROD\",\"data\":{\"userId\":$ID,\"currentUserId\":$ID}}"
done
echo '   ^ شناسه‌ی ۱۰ همان است که خودِ سرویس در GET /api/Auth?uniqueID= برمی‌گرداند'

hr '3b) و ورود هم اصلاً شناسه‌ی عددی کاربر را برنمی‌گرداند (فقط token/refreshToken/name)'
curl -s -m 30 -H 'Content-Type: application/json' -X POST "$BASE/api/Auth" \
  -d "{\"uniqueID\":\"$PROD\",\"username\":\"$USER\",\"password\":\"$PASS\"}" \
  | sed 's/"token":"[^"]*"/"token":"<حذف شد>"/; s/"refreshToken":"[^"]*"/"refreshToken":"<حذف شد>"/'; echo

hr '3c) فهرست کاربران — شناسه‌ها از همین‌جا آمده‌اند'
curl -s -m 30 "$BASE/api/Auth?uniqueID=$PROD" | head -c 400; echo

hr '4) SearchInvoice برای انواع ۵ تا ۸ خطای SQL می‌دهد: RFR.FactorhdrIDref could not be bound'
api -X POST "$BASE/api/v3/Invoice/SearchInvoice" -H "$AUTH" -d "{
  \"uniqueID\": \"$PROD\",
  \"data\": { \"currentUserID\": 10, \"viewDetails\": true, \"factType\": 5, \"fyearIdRef\": 0,
              \"fromDate\": \"1400/01/01\", \"toDate\": \"1406/12/29\",
              \"fromFactNo\": 0, \"toFactNo\": 9999999, \"fromStorage\": 0, \"toStorage\": 9999,
              \"fromDepartmentCode\": 0, \"toDepartmentCode\": 9999,
              \"payAccount\": 0, \"isRegistered\": false, \"isConfirmed\": false }
}"

hr '5) مسیرهای کالا که در PDF آمده‌اند وجود ندارند (۴۰۴)، فقط نسخه‌ی v3 هست'
for P in /api/Good/GetGoods /api/Good/CreateGood /api/v3/Good/GetGoods /api/v3/Good/CreateGood; do
  printf '%-32s HTTP %s\n' "$P" "$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST "$BASE$P" -H 'Content-Type: application/json' -d '{}')"
done
echo '   ۴۰۴ = مسیر وجود ندارد، ۴۰۱ = مسیر هست و توکن می‌خواهد'

hr '6) هیچ سرویسی برای خواندن فهرست واحد/گروه/بسته‌بندی وجود ندارد'
for P in /api/v3/Good/GetUnits /api/v3/Good/GetGoodGroups /api/v3/Good/GetUnitPacking \
         /api/v3/Unit/GetUnits /api/v3/Group/GetGroups /api/v3/Packing/GetPackings; do
  printf '%-34s HTTP %s\n' "$P" "$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST "$BASE$P" -H 'Content-Type: application/json' -d '{}')"
done
echo '   (۸۵۰ ترکیب نام محتمل تست شد، همه ۴۰۴)'

hr '7) Swagger منتشر نشده — راهی برای کشف قرارداد واقعی نیست'
for P in /swagger /swagger/index.html /swagger/v1/swagger.json /openapi/v1.json; do
  printf '%-30s HTTP %s\n' "$P" "$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$BASE$P")"
done

hr '8) نوع فیلدهای CreateGood — با uniqueID جعلی، پس هیچ کالایی ثبت نمی‌شود'
echo '--- unitPackingCodeRef = "abc"  (انتظار: خطای تبدیل به Int64)'
api -X POST "$BASE/api/v3/Good/CreateGood" -H "$AUTH" -d "{
  \"uniqueID\": \"$BOGUS\",
  \"data\": { \"name\": \"ZZ-TYPE-PROBE\", \"type\": 1, \"unitIdRef\": 5,
              \"mainGroupCodeRef\": 1, \"secondGroupCodeRef\": 1, \"unitPackingCodeRef\": \"abc\" }
}"
echo '--- همان با عدد ۷ (انتظار: از اعتبارسنجی رد می‌شود و به Sequence contains no elements می‌رسد)'
api -X POST "$BASE/api/v3/Good/CreateGood" -H "$AUTH" -d "{
  \"uniqueID\": \"$BOGUS\",
  \"data\": { \"name\": \"ZZ-TYPE-PROBE\", \"type\": 1, \"unitIdRef\": 5,
              \"mainGroupCodeRef\": 1, \"secondGroupCodeRef\": 1, \"unitPackingCodeRef\": 7 }
}"
echo '   ^ خطای اعتبارسنجی اینجا هم به نام پارامتر (good) نسبت داده می‌شود نه به فیلد واقعی'

printf '\n=== پایان\n'
