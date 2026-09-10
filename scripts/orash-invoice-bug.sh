#!/usr/bin/env bash
# CreateInvoice — رسید انبار. هیچ سندی ثبت نمی‌شود چون قبل از نوشتن خطا می‌دهد.
set -u
BASE=http://192.168.3.210:5000
PROD=44e66728-fea3-4fc9-b2bd-5ecb9bb893e2

echo "=== ۱) گرفتن توکن"
TOKEN=$(curl -s -H 'Content-Type: application/json' -X POST "$BASE/api/Auth" \
  -d "{\"uniqueID\":\"$PROD\",\"username\":\"آمنه اصیل\",\"password\":\"Asil@@23043\"}" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
echo "طول توکن: ${#TOKEN}"

echo
echo "=== ۲) ثبت رسید انبار (ft = 11)"
curl -s -w '\n[HTTP %{http_code}]\n' -X POST "$BASE/api/v3/Invoice/CreateInvoice" \
  -H 'Content-Type: application/json' \
  -H "Authorization: bearer $TOKEN" \
  -d "{
  \"uniqueID\": \"$PROD\",
  \"data\": {
    \"createuser\": 10,
    \"createdate\": \"1405/06/19\",
    \"createtime\": \"11:40\",
    \"departmentCode\": 1,
    \"visitorId\": 0,
    \"visitorPrice\": 0,
    \"value\": [
      {
        \"hid\": \"1\",
        \"ft\": \"11\",
        \"pc\": \"120001\",
        \"hsc\": \"30\",
        \"hde\": \"رسید انبار — تست\",
        \"fd\": [
          {
            \"hid\": \"1\",
            \"iid\": \"1\",
            \"gs\": \"112420000031506404071\",
            \"gc\": \"180\",
            \"fp\": \"0\",
            \"upcr\": \"6\",
            \"upc\": \"3\",
            \"upC2\": \"0\"
          }
        ]
      }
    ]
  }
}"
