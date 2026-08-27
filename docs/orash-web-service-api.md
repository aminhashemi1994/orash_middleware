# Orash Web Service (AutomationAPI) — API Reference

Reverse-documented from `Orash WEB Service.pdf` (92 pages, Persian).

- Product: Orash integrated financial software (نرم‌افزار یکپارچه مالی اوراش) — MIS
- Vendor: اوج رایانه گستر شریف (Owj Rayaneh Gostar Sharif) / orash.ir
- Doc revision: cover says `3.1.0`, page footers say `3.0.1` (Winter 1403 / Jan 2025)
- Total endpoints documented: 24

---

## 1. Deployment / prerequisites

Host requirements (Windows only, IIS-hosted ASP.NET Core app):

- Windows Server 2020+ or Windows 10+
- .NET Hosting Bundle 8
- .NET Runtime 8
- .NET Framework 3.5 and 4
- IIS (Internet Information Services)

Install steps from the PDF:

1. Download `https://orash.ir/downloads/Webservice/AutomationAPI.rar`
2. Extract to a folder on the host
3. Create a new IIS Application Pool
4. Create a new IIS Site bound to that app pool, physical path = extracted folder, pick a port
5. Browse the site → Swagger UI is served at the site root
6. Call `Install` to discover which Orash MIS databases are activated on the machine

Ports seen in the PDF examples: `5237` and `7256`. There is no documented HTTPS requirement; all samples use plain `http`.

---

## 2. Cross-cutting conventions

### 2.1 Request shape

Nearly every business endpoint takes the same envelope:

```json
{
  "uniqueID": "<database GUID>",
  "data": { /* endpoint-specific payload */ }
}
```

- `uniqueID` — GUID of the target Orash MIS database. Obtained from `Install` / `GetDatabasesInfo`. Required on essentially every call, including calls that already carry a JWT.
- `data` — the PDF tables label this `array`/`list` on most endpoints, but every JSON sample sends a single **object**. Treat `data` as an object unless an endpoint explicitly nests a `value[]` array (CreateRecPay, CreateAccDoc, CreateInvoice, InvoicePayment, CreateDriver).

### 2.2 Headers

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` (samples also show `application/json; ver=2.0` for `Auth` and `; ver=3.0` for `Auth/Refresh`) |
| `Accept` | `*/*` |
| `Authorization` | `bearer <token>` — required on everything except `Install`, `Install/Renew`, `GetDatabasesInfo`, and `Auth` |

Note the lowercase `bearer` in the docs; standard `Bearer` normally works but is unverified here.

### 2.3 Response envelope

Every endpoint returns the same wrapper:

```json
{
  "content": { } | [ ],
  "message": "Done",
  "hasError": false,
  "responseCode": 100
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `content` | object / array | payload |
| `message` | string | `"Done"` on success |
| `hasError` | boolean | transport/handler-level failure flag |
| `responseCode` | number | `100` = OK in all documented samples |

### 2.4 Business errors are *inside* `content`

This is the single most important behavioural quirk. Write endpoints (`CreateGood`, `CreateCustomer`, `CreateRecPay`, `CreateAccDoc`, `CreateDriver`, `CreateInvoice`, `InvoicePayment`) return HTTP 200 with `hasError: false` and `responseCode: 100` **even when the operation failed**. The real outcome is per-item inside `content[]`:

```json
{
  "content": [
    { "content": "0", "errorCode": -1, "errorMessage": "کد گروه اصلي صحيح نيست ." }
  ],
  "message": "Done",
  "hasError": false,
  "responseCode": 100
}
```

| Field | Meaning |
| --- | --- |
| `content` | created record's code on success, `"0"` on failure |
| `errorCode` | `0` = no error, `-1` = error |
| `errorMessage` | Persian success or failure message |

Inconsistency to guard against: the `CreateRecPay` samples use `errorCode: 1` for errors instead of `-1`. Any middleware should treat `errorCode != 0` as failure rather than testing for `-1`.

Success example:

```json
{
  "content": [
    { "content": "71012", "errorCode": 0, "errorMessage": "کالاي مورد نظر با 71012 درج شد" }
  ],
  "message": "Done", "hasError": false, "responseCode": 100
}
```

### 2.5 Dates and times

- Jalali (Shamsi) date strings, quoted: `"1400/08/01"` → `yyyy/MM/dd`
- Time strings: `"10:31"` → `HH:mm`
- The `CreateInvoice` table shows the example as `"01/08/1400"`, which contradicts every other endpoint. `yyyy/MM/dd` is the safe assumption; verify against a live instance.
- Dates outside a defined fiscal year are rejected: `تاريخ وارد شده در بازه ي سال مالي تعريف شده نمي باشد`

### 2.6 Header/detail linking (`hid`)

Multi-row documents (receipt/payment, accounting voucher, invoice) are posted as a flat header + detail structure joined by a client-generated correlation key:

- `hid` — unique per header, repeated on every child detail row. Must not be empty.
- `iid` — unique per detail row within a header.
- `row` — explicit row number (accounting voucher).

The server matches headers to details by `hid`, so the caller owns key generation.

---

## 3. Endpoint index

| # | Operation | Method | Path | Auth |
| --- | --- | --- | --- | --- |
| 1 | Install | POST | `/api/Install` | no |
| 2 | Renew | POST | `/api/Install/Renew` | no |
| 3 | GetDatabasesInfo | GET | `/api/Install/GetDatabasesInfo` | no |
| 4 | Auth (login) | POST | `/api/Auth` | no |
| 5 | List users | GET | `/api/Auth?uniqueID=` | no |
| 6 | RefreshToken | POST | `/api/Auth/Refresh` | yes |
| 7 | CreateGood | POST | `/api/Good/CreateGood` | yes |
| 8 | GetGoods | POST | `/api/Good/GetGoods` | yes |
| 9 | ChangeGoodRate | POST | `/api/v3/Good/ChangeGoodRate` | yes |
| 10 | CreateCustomer | POST | `/api/v3/Customer/CreateCustomer` | yes |
| 11 | GetCustomer | POST | `/api/v3/Customer/GetCustomer` | yes |
| 12 | CreateRecPay | POST | `/api/RecPay/CreateRecPay` | yes |
| 13 | CreateAccDoc | POST | `/api/v3/AccDoc/CreateAccDoc` | yes |
| 14 | GetStockStorage | POST | `/api/v3/Storage/GetStockStorage` | yes |
| 15 | GetStorages | POST | `/api/v3/Storage/GetStorages` | yes |
| 16 | GetDepartments | POST | `/api/v3/Department/GetDepartments` | yes |
| 17 | GetTafsili2 | POST | `/api/v3/Tafsili/GetTafsili2` | yes |
| 18 | CreateDriver | POST | `/api/v3/Driver/CreateDriver` | yes |
| 19 | GetDriversInfo | GET | `/api/Driver/GetDriversInfo?uniqueID=` | yes |
| 20 | CreateInvoice | POST | `/api/v3/Invoice/CreateInvoice` | yes |
| 21 | SearchInvoice | POST | `/api/v3/Invoice/SearchInvoice` | yes |
| 22 | InvoicePayment | POST | `/api/v3/Invoice/InvoicePayment` | yes |
| 23 | GetRPAccount | POST | `/api/v3/RPAccount/GetRPAccount` | yes |
| 24 | GetRPAccountDetail | POST | `/api/v3/RPAccount/GetRPAccountDetail` | yes |

Path versioning is inconsistent: `Install`, `Auth`, `Good/CreateGood`, `Good/GetGoods`, `RecPay/CreateRecPay` and `Driver/GetDriversInfo` are unversioned; everything else sits under `/api/v3/`.

**Checked against the live host (192.168.3.210:5000), 2026-08-27:** the goods
paths the PDF gives unversioned do **not** exist there. `POST /api/Good/GetGoods`
and `POST /api/Good/CreateGood` answer `404`, while `/api/v3/Good/GetGoods` and
`/api/v3/Good/CreateGood` answer `401` without a token — i.e. they are the real
routes. Treat the unversioned goods paths in this document as out of date and
use `/api/v3/` for them, as `server.js` already does. There is no Swagger
document exposed (`/swagger/*` → 404), so the endpoint list cannot be verified
any further without credentials.

---

## 4. Bootstrap & authentication

### 4.1 `POST /api/Install`

Discovers the Orash MIS databases activated on the host and returns their GUIDs. Run this first — every other call needs a `uniqueID` from here. No body, no auth.

```bash
curl --location --request POST 'http://localhost:5237/api/Install'
```

Response:

```json
{
  "content": {
    "lockCode": "123456",
    "orashMisDatabases": [
      { "uniqueID": "8AFBC964-ACB7-49AB-A901-0AC7627328C9", "name": "orash1", "companyName": "عنوان شرکت" },
      { "uniqueID": "AB131D34-9A23-43EE-8308-E8A5D1DEC6CC", "name": "Orash2", "companyName": "عنوان شرکت" }
    ]
  },
  "message": "Done", "hasError": false, "responseCode": 100
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `content.lockCode` | string | hardware/licence lock number (شماره قفل) |
| `content.orashMisDatabases[]` | array | activated databases |
| `.uniqueID` | string | database GUID — the `uniqueID` used everywhere else |
| `.name` | string | SQL database name |
| `.companyName` | string | company display name |

### 4.2 `POST /api/Install/Renew`

Re-runs discovery and reports previous + new database GUIDs. Identical response schema to `Install`. Use after adding/moving a company database.

### 4.3 `GET /api/Install/GetDatabasesInfo`

Read-only version of `Install`. Same response schema.

Doc bug: the method is documented as `GET` but the sample curl uses `--request POST`. Try GET first.

### 4.4 `POST /api/Auth` — login

Returns a JWT plus refresh token.

Request:

```json
{ "username": "string", "password": "string", "uniqueID": "string" }
```

| Field | Required | Type |
| --- | --- | --- |
| `username` | yes | string |
| `password` | yes | string |
| `uniqueID` | yes | string (database GUID) |

Response:

```json
{
  "content": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "nvU4D+0f18LRhzCgpaQiDLRmgtVy7jDD5vbwK0s6w+w=",
    "name": "کاربر"
  },
  "message": "Done", "hasError": false, "responseCode": 100
}
```

Send it back as `Authorization: bearer <token>`.

The sample JWT decodes to claims `unique_name`, `country: IR`, `role: ServiceAdmin`, `nameid` (GUID), `sub: UserAuthentication`, `jti`, `iat`, `nbf`, `exp`. In the sample, `exp - iat` = 43200 s → **12-hour token lifetime**. Not stated in prose, inferred from the sample payload.

### 4.5 `GET /api/Auth?uniqueID=<guid>` — list Orash users

Lists the software's user accounts for a database. Needed because many write endpoints require a numeric `createuser` / `currentUserId` that must already exist in Orash.

```bash
curl -X GET 'http://localhost:7256/api/Auth?uniqueID=6e9964a2-29eb-43c8-a9d3-95beb4394630' -H 'accept: */*'
```

```json
{
  "content": [
    { "id": 5, "userName": "کاربر 1", "fullName": "کاربر 1" },
    { "id": 9, "userName": "کاربر 2", "fullName": "کاربر 2" }
  ],
  "message": "Done", "hasError": false, "responseCode": 100
}
```

`content[].id` is the value to pass as `createuser` / `userId` / `currentUserId` elsewhere.

Security note: this endpoint enumerates usernames with no authentication required per the docs. If this service is exposed beyond localhost, put it behind a network boundary.

### 4.6 `POST /api/Auth/Refresh`

Request (auth header required):

```json
{ "uniqueID": "string", "token": "string" }
```

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `uniqueID` | yes | string | database GUID |
| `token` | yes | string | current token |

Returns the same `{ token, refreshToken, name }` content as `Auth`.

Ambiguity: the prose says you send "token, refresh token and username", but both the parameter table and the JSON sample only contain `uniqueID` and `token`. The `refreshToken` from login appears to be unused by this endpoint as documented.

---

## 5. Goods

### 5.1 `POST /api/Good/CreateGood`

Creates a good or service.

Doc bug: the "input values" table for this endpoint only lists `uniqueID` + `token`; the real field list is in the table labelled "response values". The table below is the corrected input contract, cross-checked against the JSON sample.

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `uniqueID` | yes | string | database GUID |
| `data` | yes | object | payload |
| `data.code` | no | string | goods/service code. `null` → server assigns its suggested code |
| `data.name` | yes | string | goods/service title |
| `data.type` | yes | long | `1` = good (کالا), `2` = service (خدمات) |
| `data.unitIdRef` | yes | long | unit-of-measure code |
| `data.mainGroupCodeRef` | yes | long | main group code |
| `data.secondGroupCodeRef` | yes | long | sub-group code |
| `data.isAdded` | no | bool | (undocumented meaning; likely VAT-applicable on sale) |
| `data.isBuyAdded` | no | bool | (undocumented; likely VAT-applicable on purchase) |
| `data.serial` | no | string | serial |
| `data.fiPrice1` | no | decimal | sale price 1 |
| `data.offPercent1` | no | decimal | discount % 1 |
| `data.fiPrice2` | no | decimal | sale price 2 |
| `data.offPercent2` | no | decimal | discount % 2 |
| `data.fiPrice3` | no | decimal | sale price 3 |
| `data.offPercent3` | no | decimal | discount % 3 |
| `data.saleName` | no | string | sale title |
| `data.unitPackingCodeRef` | no | long | packing unit code — **verified live**: binds to `Nullable<Int64>`, so a numeric id, and `null` is accepted. A numeric *string* (`"7"`) is also accepted; a non-numeric string is rejected with `400` |
| `data.taxPercent` | no | decimal | tax % |
| `data.lengthValue` | no | decimal | length |
| `data.widthValue` | no | decimal | width |
| `data.heightValue` | no | decimal | height |
| `data.goodCategoryIdRef` | no | long | goods category code |
| `data.isActive` | no | bool | `1` active / `0` inactive; empty defaults to `1` |
| `data.diameterValue` | no | decimal | diameter |
| `data.serialsControl` | no | bool | serial tracking; empty defaults to `0` |
| `data.patternIdRef` | no | long | goods definition pattern |
| `data.nationalCode` | no | string | national goods code (کد ملی) |
| `data.weightPack` | no | long | packaging weight |
| `data.weightGoods` | no | long | goods weight |
| `data.criterionWeight` | no | long | criterion weight |
| `data.dimensionsLengthPack` | no | decimal | packaging length |
| `data.dimensionsWidthPack` | no | decimal | packaging width |
| `data.dimensionsHeightPack` | no | decimal | packaging height |
| `data.dimensionsLengthGoods` | no | decimal | goods length |
| `data.dimensionsWidthGoods` | no | decimal | goods width |
| `data.dimensionsHeightGoods` | no | decimal | goods height |
| `data.criterionDimensions` | no | long | criterion dimensions |

Response: standard `content[] { content, errorCode, errorMessage }` where `content` is the new goods code.

Documented validation failures:

| `errorMessage` | Cause |
| --- | --- |
| `مقدار فيلد عنوان کالا و خدمات تکراري است` | duplicate `name` |
| `کد واحد اندازه گيري وارد شده صحيح نيست` | bad `unitIdRef` |
| `کد گروه اصلي صحيح نيست` | bad `mainGroupCodeRef` |
| `کد گروه فرعي صحيح نيست` | bad `secondGroupCodeRef` |

Note there is no documented endpoint to *list* units, main groups, sub-groups, categories or patterns — those reference codes must come from the Orash desktop app or the database directly. This is a real gap for a middleware layer.

**Verified against the live host, 2026-08-27 — no undocumented lookup exists either.**
850 candidate paths were probed (`Good`/`Unit`/`Group`/`Packing`/`Reference`/… ×
`GetUnits`/`GetMainGroups`/`GetPackings`/… , both `/api/` and `/api/v3/`): every one
answered `404`. The probe is trustworthy because a route that *does* exist answers
distinctly — `POST /api/v3/Good/GetGoods` → `401` without a token, and `GET` on it
→ `405` — so `404` really means "no such route". No discovery surface is exposed
either (`/`, `/api`, `/api/v3`, `/health`, `/swagger/*`, `/openapi/v1.json` → 404).

So the only place any of these four codes can be read from is `GetGoods`, and even
there the response carries the *names* (`unitsName`, `unitPackingName`,
`mainGroupName`, `secondGroupName`) — the PDF documents no code fields alongside
them. There is no name → code translation anywhere in this API.

### 5.2 `POST /api/Good/GetGoods`

Search goods. All `data` members act as filters; it also doubles as a stock-lookup and price-list endpoint via flags.

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `uniqueID` | yes | string | database GUID |
| `data.code` | no | string | goods code |
| `data.name` | no | string | title |
| `data.type` | no | long | `1` good / `2` service |
| `data.unitsName` | no | string | unit name |
| `data.mainGroupName` | no | string | main group name |
| `data.secondGroupName` | no | string | sub-group name |
| `data.serial` | no | string | serial |
| `data.fiPrice1..3` | no | decimal | prices |
| `data.offPercent1..3` | no | decimal | discount % |
| `data.saleName` | no | string | sale title |
| `data.unitPackingName` | no | string | packing unit name |
| `data.taxPercent` | no | string | tax % (typed `string` here, `decimal` in CreateGood) |
| `data.lengthValue` / `widthValue` / `heightValue` / `diameterValue` | no | decimal | dimensions |
| `data.goodCategoryName` | no | string | category name |
| `data.isActive` | no | bool | active flag; empty → `1` |
| `data.goodPatternName` | no | string | pattern name |
| `data.nationalCode` | no | decimal | national code (typed `decimal` here, `string` in CreateGood) |
| `data.weightPack` / `weightGoods` | no | decimal | weights |
| `data.showStockFlg` | yes | bool | include stock balances |
| `data.storageCode` | if `showStockFlg` | long | warehouse code |
| `data.storageName` | if `showStockFlg` | string | warehouse name |
| `data.flagDepartment` | yes | bool | filter by branch |
| `data.fromDepartment` | yes | long | branch code from |
| `data.toDepartment` | yes | long | branch code to |
| `data.currentUserId` | yes | long | acting user id (table misspells it `currentUSerId`; the sample uses `currentUserId`) |
| `data.withFi` | yes | bool | return sale price list |
| `data.date` | if `withFi` | string | price-list date |
| `data.fromCode` | if `withFi` | string | goods code from |
| `data.toCode` | if `withFi` | string | goods code to |

Two documented usage modes:

Plain search:

```json
{
  "uniqueID": "b7c1423f-04f8-4738-abad-e977fdef0805",
  "data": {
    "code": "string", "name": "string",
    "showStockFlg": false,
    "flagDepartment": true, "fromDepartment": 0, "toDepartment": 0,
    "currentUserId": 0, "withFi": false
  }
}
```

Sale price list:

```json
{
  "uniqueID": "string",
  "data": {
    "flagDepartment": true, "fromDepartment": 0, "toDepartment": 0,
    "currentUserId": 0,
    "withFi": true, "date": "string", "fromCode": "string", "toCode": "string"
  }
}
```

The PDF does not document the response schema for this endpoint — only request bodies. Response fields have to be discovered from a live call or Swagger.

**Types confirmed live for `CreateGood`, 2026-08-27.** Probed with a `uniqueID` that
matches no database, so the model binder's verdict is observed while the controller
can never reach a real one (it fails with `Sequence contains no elements`; nothing is
written). `unitIdRef`, `mainGroupCodeRef`, `secondGroupCodeRef` and
`unitPackingCodeRef` all bind to `Nullable<Int64>` — numeric ids, not strings — and
`name` binds to `String` (a number is rejected). As with `GetGoods`, a binding
failure is misreported against the parameter name: `{"good":["The good field is
required."]}` alongside the real `$.data.<field>` error.

**Checked against the live host (192.168.3.210:5000) with a real prod account, 2026-08-27 — this endpoint is currently broken server-side:**

1. The path is `/api/v3/Good/GetGoods`; the unversioned one the PDF gives is `404`.
2. Types the PDF gets wrong. The model binder rejects the documented booleans:
   `showStockFlg` binds to **`Int64`** (send `0`/`1`, not `false`), `withFi` binds
   to `Boolean`, `taxPercent` to `Nullable<Decimal>`. A wrong type yields `400`
   with `"The JSON value could not be converted to …"`.
3. The body member is still `data`, but a binding failure is reported against the
   *parameter* name: `{"errors":{"goodSearch":["The goodSearch field is required."]}}`
   means the `data` object failed to deserialize — read the sibling `$.data.<field>`
   error for the real cause. Sending a literal `goodSearch` member does not help.
4. With a well-formed body the call reaches SQL and fails there:
   `HTTP 500 — "Procedure or function SearchGoods has too many arguments specified."`
   This happens with any filter, including an empty `data: {}`, so it is not
   caused by the request: the `SearchGoods` stored procedure in the production
   database has fewer parameters than this API build passes it. **Orash has to
   update the database/procedure; nothing on the client side can work around it.**
5. Separately, every lookup that takes a `currentUserId` rejects it. `GetStorages`
   and `GetDepartments` answer `HTTP 200` but with a business error row
   (`storageCode: -1`, `"کد کاربر صحيح نيست ."`) for **every** id tried — including
   the ids `GET /api/Auth?uniqueID=` itself returns — under all three spellings
   (`userId`, `currentUserId`, `currentUSerId`). Login does not return a numeric
   user id at all: `/api/Auth` yields only `{token, refreshToken, name}`, and the
   JWT carries a GUID `nameid`, not the integer these endpoints want. So there is
   no documented way to obtain a `currentUserId` the service accepts.

Consequence for this middleware: the reference dropdowns (unit, packing, main and
second group) are built from `GetGoods` rows and stay empty until this is fixed.

### 5.3 `POST /api/v3/Good/ChangeGoodRate`

Updates the three sale rates and discounts of a good in a warehouse. All fields marked required.

| Field | Type | Meaning |
| --- | --- | --- |
| `uniqueID` | string | database GUID |
| `data.goodCode` | string | goods code |
| `data.storageCode` | long | warehouse code |
| `data.fiPrice1` | decimal | rate 1 |
| `data.offPercent1` | decimal | discount % 1 |
| `data.fiPrice2` | decimal | rate 2 |
| `data.offPercent2` | decimal | discount % 2 |
| `data.fiPrice3` | decimal | rate 3 |
| `data.offPercent3` | decimal | discount % 3 |
| `data.userIdRef` | decimal | acting user code |

```json
{
  "uniqueID": "string",
  "data": {
    "goodCode": "string", "storageCode": 0,
    "fiPrice1": 0, "offPercent1": 0,
    "fiPrice2": 0, "offPercent2": 0,
    "fiPrice3": 0, "offPercent3": 0,
    "userIdRef": 0
  }
}
```

`data` is typed `list` in the table but sent as an object in the sample. No response schema documented.

---

## 6. Accounts / customers

### 6.1 `POST /api/v3/Customer/CreateCustomer`

Creates an account (person, expense, bank, cash box, or petty cash).

Account-class flags — exactly one of `persons`, `expence`, `bank`, `cash`, `tuner` may be `1`. Setting more than one returns `فقط يکي از گزينه هاي اشخاص ، هزينه ، بانک ، صندوق يا تنخواه را مي توانيد انتخاب کنيد`.

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `uniqueID` | yes | string | database GUID |
| `data.code` | yes | long | account code |
| `data.name` | yes | string | account title |
| `data.tel` | no | string | phone |
| `data.address` | no | string | address |
| `data.persons` | yes | bool | persons & other accounts |
| `data.expence` | yes | bool | expense & other income (note the misspelling — it is the wire name) |
| `data.bank` | yes | bool | bank |
| `data.cash` | yes | bool | cash box (صندوق) |
| `data.tuner` | yes | bool | petty cash (تنخواه) |
| `data.klCodeRef` | yes | string | general ledger code (کد کل) |
| `data.mnCodeRef` | yes | string | subsidiary ledger code (کد معین) |
| `data.perType` | no | long | `2` = natural person, `1` = legal entity, `0` = account |
| `data.mobile` | no | string | mobile |
| `data.fax` | no | string | fax |
| `data.economicCode` | no | string | economic code |
| `data.nationalCode` | no | string | national ID |
| `data.registerNo` | no | string | registration number |
| `data.postCode` | no | string | postal code |
| `data.nationalNo` | no | string | national entity ID (شناسه ملی) |
| `data.email` | no | string | email |
| `data.description` | no | string | notes |
| `data.goodRequest` | no | string | (undocumented) |
| `data.address2` / `tel2` / `mobile2` / `email2` | no | string | secondary contact set |
| `data.klCashCodeRef` | no | string | GL account, notes at cash box |
| `data.mnCashCodeRef` | no | string | subsidiary, notes at cash box |
| `data.klBankCodeRef` | no | string | GL account, notes at bank |
| `data.mnBankCodeRef` | no | string | subsidiary, notes at bank |
| `data.klPayCodeRef` | no | string | GL account, notes payable |
| `data.mnPayCodeRef` | no | string | subsidiary, notes payable |
| `data.craft` | no | string | trade / requested goods & services |
| `data.stateIdRef` | yes | long | province code |
| `data.cityIdRef` | yes | long | city code |
| `data.visitorCodeRef` | no | long | default salesperson code |
| `data.actualType` | no | long | taxpayer class — see below |
| `data.transactionTaxType` | no | long | transaction subject — see below |
| `data.rateDefualt` | no | long | default sale rate: `1`, `2` or `3` (misspelling is the wire name) |
| `data.branchName` | no | string | bank branch name |
| `data.accountType` | no | string | bank account type |
| `data.accountOwner` | no | string | account holder |
| `data.shebaNo` | no | string | IBAN / SHEBA |
| `data.cardNo` | no | string | card number |
| `data.branchTel` / `branchFax` | no | string | branch phone / fax |
| `data.accountNo` | no | string | bank account number |
| `data.isActive` | no | bool | active flag |
| `data.fName` / `lName` | no | string | first / last name |
| `data.calcTax` | no | bool | apply VAT: `1` on, `0` off |
| `data.mainGroupCodeRef` | yes | long | account main group code |
| `data.secondGroupCodeRef` | yes | long | account sub-group code |

`actualType` (taxpayer class). The PDF line is scrambled by RTL rendering; reading it as intended:

| Value | Meaning |
| --- | --- |
| 1 | subject to Article 18 (مشمولین ماده ۱۸ — printed as "81" due to bidi) |
| 2 | not subject to registration (غیر مشمول ثبت نام) |
| 3 | subject to registration (مشمول ثبت نام) |
| 4 | final consumer (مصرف کننده نهایی) |

`transactionTaxType` (subject of transaction, buy/sell; nullable). Also bidi-scrambled in the source; de-scrambled:

| Value | Subject |
| --- | --- |
| 1 | pharmaceuticals (دارو) |
| 2 | tobacco (دخانیات) |
| 3 | mobile phones (موبایل) |
| 4 | home appliances (لوازم خانگی) |
| 5 | consumable & spare vehicle parts (قطعات مصرفی/یدکی وسایل نقلیه) |
| 6 | petroleum, gas & petrochemical products (فرآورده‌ها و مشتقات نفتی، گازی و پتروشیمی) |
| 7 | gold — bullion, coins, ornaments (طلا: شمش، مسکوکات، مصنوعات زینتی) |
| 8 | textiles, live animals, white & red meat (منسوجات، دام زنده، گوشت سفید و قرمز) |
| 9 | clothing (پوشاک) |
| 10 | toys (اسباب بازی) |
| 11 | basic agricultural products (محصولات اساسی کشاورزی) |
| 12 | other goods & services (سایر کالاها و خدمات) |

Because this enumeration is reconstructed from mangled text, verify values 8–12 against the live system before relying on them for tax reporting.

Documented validation failures:

| `errorMessage` | Cause |
| --- | --- |
| `مقدار کد حساب ، کد گروه اصلي و کد گروه فرعي وارد نشده است` | missing code / main group / sub-group |
| `مقدار فيلد کد حساب وارد نشده` | missing `code` |
| `فقط يکي از گزينه هاي اشخاص ، هزينه ، بانک ، صندوق يا تنخواه را مي توانيد انتخاب کنيد` | more than one class flag set |
| `کد کل و معين پيش فرض صحيح نيست` | bad `klCodeRef` / `mnCodeRef` |
| `کد استان و شهر صحيح نيست` | bad `stateIdRef` / `cityIdRef` |
| `کد ويزيتور صحيح نيست` | bad `visitorCodeRef` |

### 6.2 `POST /api/v3/Customer/GetCustomer`

Search accounts. Every filter is optional except the four branch/user fields.

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `uniqueID` | no* | string | database GUID (marked optional in the table, but required in practice) |
| `data.code` | no | string | account code |
| `data.name` | no | string | title |
| `data.tel` | no | long | phone |
| `data.address` | no | string | address |
| `data.persons` / `expence` / `bank` / `cash` / `tuner` | no | string / decimal | class filters (types are inconsistent in the table; the sample sends booleans) |
| `data.perType` | no | decimal | `2` natural / `1` legal / `0` account |
| `data.mobile` | no | decimal | mobile (sample sends string) |
| `data.fax`, `economicCode`, `nationalCode`, `registerNo`, `postCode`, `nationalNo`, `email`, `description` | no | string | identity filters |
| `data.isActive` | no | bool | active flag |
| `data.fName` / `lName` | no | string | first / last name |
| `data.fromPerMainGroup` / `toPerMainGroup` | no | long | account main group range |
| `data.fromPerSecondGroup` / `toPerSecondGroup` | no | long | account sub-group range |
| `data.flagDepartment` | yes | bool | branch filter on |
| `data.fromDepartment` / `toDepartment` | yes | long | branch code range |
| `data.currentUserId` | yes | long | acting user id |

Response rows (from the sample) — note these are *display* names, not the `*CodeRef` inputs:

`code`, `name`, `tel`, `address`, `persons`, `expence`, `bank`, `cash`, `tuner`, `perType`, `mobile`, `fax`, `economicCode`, `nationalCode`, `registerNo`, `postCode`, `nationalNo`, `description`, `isActive`, `fName`, `lName`, `acount`, `klName`, `mnName`, `type`, `email`, `goodRequest`, `address2`, `tel2`, `mobile2`, `email2`, `klCashName`, `klBank`, `mnBank`, `klPay`, `mnPay`, `craft`, `state`, `city`, `visitor`, `actualType`, `transactionTaxType`, `rateDefualt`, `branchName`, `acoountType`, `accountOwner`, `shebaNo`, `cardNo`, `branchTel`, `branchFax`, `accountNo`, `departmentCode`, `departmentName`

```json
{
  "content": [
    {
      "code": 101000001,
      "name": "حواله نامشخص",
      "cash": true, "persons": false, "expence": false, "bank": false, "tuner": false,
      "acount": "صندوق",
      "type": "حقيقي",
      "isActive": true,
      "departmentCode": 1,
      "departmentName": "شعبه آبادگران"
    }
  ],
  "message": "Done", "hasError": false, "responseCode": 100
}
```

Round-trip asymmetry worth noting for a middleware: `CreateCustomer` takes `accountType`, `GetCustomer` returns `acoountType` (double `o`). Also create takes `klCashCodeRef`/`mnCashCodeRef` but read returns only `klCashName` — there is no `mnCashName`.

---

## 7. Receipts & payments

### 7.1 `POST /api/RecPay/CreateRecPay`

Registers a receipt or payment voucher. Header/detail structure: `data` holds the voucher context, `data.value[]` holds one or more vouchers, each with `rd[]` detail rows.

Header context (`data`):

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `uniqueID` | yes | string | database GUID |
| `data.createUser` | yes | string* | Orash user id creating the voucher. Must already exist in the users table or the call fails. *Table says `string`, sample sends `0` (number). |
| `data.createDate` | yes | string | Jalali date, e.g. `"1400/08/01"`. Must fall inside a defined fiscal year. |
| `data.createTime` | yes | string | e.g. `"10:31"` |
| `data.departmentCode` | yes | long | branch code |
| `data.value` | yes | array | voucher list |

Voucher (`data.value[]`):

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `hid` | yes | string | correlation key, repeated on details |
| `pc` | yes | string | person/account code (کد شخص) |
| `rpt` | yes | string | receive/pay type — see table below |
| `rpc` | yes | string | receive/pay code |
| `t2` | no | string | tafsili 2 (cost centre) |
| `et` | no | string | expense-recognition specific field |
| `rd` | yes | array | detail rows |

`rpt` — RecievePayType:

| Value | Meaning |
| --- | --- |
| 1 | cash-box receipt (دریافت صندوق) |
| 2 | cash-box payment (پرداخت صندوق) |
| 3 | cash withdrawal from bank (برداشت نقدی از بانک) |
| 4 | cash deposit to bank (واریز نقدی به بانک) |
| 5 | expense recognition (شناسایی هزینه) |
| 6 | petty cash / revolving fund (تنخواه گردان) |

Detail row (`rd[]`):

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `hid` | yes | string | must equal the parent `hid` |
| `iid` | yes | string | row number |
| `prc` | yes | string | payer/payee account code (PerRecievCode) |
| `idisc` | no | string | row description |
| `p` | yes | string | amount |
| `tax` | no | string | tax |
| `t2` | no | string | tafsili 2 |
| `prC1` | no | string | counterparty account code (nullable) |
| `t21` | no | string | counterparty tafsili 2 |

```json
{
  "uniqueID": "string",
  "data": {
    "createUser": 0,
    "createDate": "string",
    "createTime": "string",
    "departmentCode": 0,
    "value": [
      {
        "hid": "string", "pc": "string", "rpt": "string", "rpc": "string",
        "t2": "string", "et": "string",
        "rd": [
          { "hid": "string", "iid": "string", "prc": "string", "idisc": "string",
            "p": "string", "tax": "string", "t2": "string",
            "prC1": "string", "t21": "string" }
        ]
      }
    ]
  }
}
```

Documented failures (note `errorCode: 1`, not `-1`):

| `errorMessage` | Cause |
| --- | --- |
| `تاريخ وارد شده در بازه ي سال مالي تعريف شده نمي باشد` | date outside fiscal year |
| `کاربر مورد نظر در شعبه وارد شده مجاز نيست` | user not permitted in that branch |
| `کد شعبه وارد شده صحيح نمي باشد` | bad `departmentCode` |
| `کد کاربر وارد شده صحيح نمي باشد` | bad `createUser` |

Casing note: the parameter table writes `createuser` / `createdate` / `createtime` (lowercase), the JSON sample writes `createUser` / `createDate` / `createTime`. `CreateAccDoc` does the opposite. ASP.NET Core model binding is case-insensitive by default, so either should bind, but the sample casing is the safer choice per endpoint.

---

## 8. Accounting vouchers

### 8.1 `POST /api/v3/AccDoc/CreateAccDoc`

Posts a manual journal voucher.

Header context (`data`):

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `uniqueID` | yes | string | database GUID |
| `data.createuser` | yes | long | Orash user id; must exist |
| `data.createdate` | yes | string | Jalali date `"1400/08/01"`, inside a defined fiscal year |
| `data.createtime` | yes | string | `"10:31"` |
| `data.departmentCode` | yes | long | branch code |
| `data.value` | yes | array | voucher list |

Voucher (`data.value[]`):

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `hid` | yes | string | correlation key |
| `ano` | no | string | voucher sheet number (شماره برگه). If supplied and not already posted, it is used; if omitted, the server allocates a new number. |
| `hdec` | no | string | header description |
| `ad` | yes | array | detail rows |

Detail row (`ad[]`):

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `hid` | yes | string | must equal parent `hid` |
| `iid` | yes | string | unique row key within the header |
| `row` | yes | string | row number |
| `kl` | yes | string | GL account code (کل) |
| `mn` | yes | string | subsidiary code (معین) |
| `tc` | yes | string | detail/tafsili code |
| `ide` | no | string | row description |
| `d` | yes | string | debit; empty → 0 |
| `c` | yes | string | credit; empty → 0 |
| `t2` | no | string | tafsili 2 |

```json
{
  "uniqueID": "string",
  "data": {
    "createuser": 0, "createdate": "string", "createtime": "string",
    "departmentCode": 0,
    "value": [
      {
        "hid": "string", "ano": "string", "hdec": "string",
        "ad": [
          { "hid": "string", "iid": "string", "row": "string",
            "kl": "string", "mn": "string", "tc": "string", "ide": "string",
            "d": "string", "c": "string", "t2": "string" }
        ]
      }
    ]
  }
}
```

Success: `content: [{ "content": "112", "errorCode": 0, "errorMessage": "سند شماره 112 درج شد" }]` — `content` is the voucher number.

The docs do not state whether the service validates that debits equal credits. Assume it does not and balance the voucher client-side.

---

## 9. Reference data (warehouses, branches, tafsili)

These three endpoints share an identical contract and differ only in path and response rows. All are `POST` despite being pure reads.

Common request:

```json
{ "uniqueID": "string", "data": { "userId": 4 } }
```

Doc bug on all three: the parameter table calls the field `createuser` (`string`, required) but every JSON sample sends `userId` (number). Follow the sample — `userId`.

### 9.1 `POST /api/v3/Storage/GetStorages`

Warehouses visible to a given user.

| Response field | Type | Meaning |
| --- | --- | --- |
| `storageCode` | long | warehouse code |
| `storageName` | string | warehouse name |
| `departmentCode` | long | branch code |
| `departmentName` | string | branch name |

```json
{
  "content": [
    { "storageCode": 24, "storageName": "انبار شانديز", "departmentCode": 17, "departmentName": "شعبه شانديز ( پيشتازان )" },
    { "storageCode": 26, "storageName": "انبار سرابی",  "departmentCode": 18, "departmentName": "شعبه سرابی ( نگين )" }
  ],
  "message": "Done", "hasError": false, "responseCode": 100
}
```

### 9.2 `POST /api/v3/Department/GetDepartments`

Branches visible to a given user.

| Response field | Type | Meaning |
| --- | --- | --- |
| `departmentCode` | string | branch code (returned as number in the sample) |
| `departmentName` | string | branch name |

### 9.3 `POST /api/v3/Tafsili/GetTafsili2`

Tafsili-2 (cost centre) list per branch. Note the same `tafsiliCode` repeats across branches, so the key is the `(tafsiliCode, departmentCode)` pair.

| Response field | Type | Meaning |
| --- | --- | --- |
| `tafsiliCode` | long | tafsili 2 code |
| `tafsiliName` | string | tafsili 2 name |
| `departmentCode` | long | branch code |
| `departmentName` | string | branch name |

### 9.4 `POST /api/v3/Storage/GetStockStorage`

Stock balance of one good in one warehouse.

| Field | Type | Meaning |
| --- | --- | --- |
| `uniqueID` | string | database GUID |
| `data.goodsCode` | long / string | goods code |
| `data.storageCode` | string / long | warehouse code |

The parameter table types are swapped relative to the sample (`goodsCode` typed `long` but sent as `"string"`; `storageCode` typed `string` but sent as `0`). Follow the sample:

```json
{ "uniqueID": "string", "data": { "goodsCode": "string", "storageCode": 0 } }
```

Response:

| Field | Meaning |
| --- | --- |
| `realCount` | physical stock (موجودی واقعی) |
| `usableCount` | available/usable stock (موجودی قابل استفاده) |

```json
{ "content": [ { "realCount": 12, "usableCount": 10 } ], "message": "Done", "hasError": false, "responseCode": 100 }
```

`content` is documented as `object` but returned as an array.

---

## 10. Drivers

### 10.1 `POST /api/v3/Driver/CreateDriver`

Registers a driver (used by invoice waybills, `fb[].dc`).

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `uniqueID` | yes | string | database GUID |
| `data.value` | yes | array | driver list |
| `value[].did` | yes | string | unique key |
| `value[].code` | yes | string | driver code |
| `value[].name` | yes | string | driver name |
| `value[].cm` | no | string | car model |
| `value[].p1` | no | string | plate part 1 |
| `value[].p2` | no | string | plate part 2 |
| `value[].p3` | no | string | plate part 3 (table says `object`, sample sends string) |
| `value[].p4` | no | string | plate part 4 |
| `value[].dt` | no | string | contact number |
| `value[].dtfc` | no | string | debit tafsili |
| `value[].ctfc` | no | string | credit tafsili |
| `value[].dtF2C` | no | string | debit tafsili 2 code |
| `value[].dtF2L` | no | string | debit tafsili 2 level |
| `value[].ctF2C` | no | string | credit tafsili 2 code |
| `value[].ctF2L` | no | string | credit tafsili 2 level |
| `value[].wf` | no | string | vehicle weight |
| `value[].cic` | no | string | debit "instead" (بابت) code |
| `value[].dic` | no | string | credit "instead" (بابت) code |
| `value[].ar` | no | string | (undocumented; maps to `accAndReport` in the read model) |

The PDF labels `p2`, `p3`, `p4` all as "plate part 1" — a copy/paste slip; they are parts 2, 3 and 4.

Also note `cic`/`dic` are described as debit-then-credit while the read model returns `creditInsteadCodeRef` / `debitInsteadCodeRef`; the mapping between `cic`/`dic` and credit/debit is ambiguous in the source. Verify before use.

```json
{
  "uniqueID": "string",
  "data": {
    "value": [
      { "did": "string", "code": "string", "name": "string", "cm": "string",
        "p1": "string", "p2": "string", "p3": "string", "p4": "string",
        "dt": "string", "dtfc": "string", "ctfc": "string",
        "dtF2C": "string", "dtF2L": "string", "ctF2C": "string", "ctF2L": "string",
        "wf": "string", "cic": "string", "dic": "string", "ar": "string" }
    ]
  }
}
```

Response: standard `{ content, errorCode, errorMessage }` items; `content` is the created driver code.

### 10.2 `GET /api/Driver/GetDriversInfo?uniqueID=<guid>`

Lists drivers. Only input is the `uniqueID` query parameter. Requires the auth header.

| Response field | Type | Maps to create field |
| --- | --- | --- |
| `code` | long | `code` |
| `name` | string | `name` |
| `carModel` | string | `cm` |
| `partOnePelak` | string | `p1` |
| `partTwoPelak` | string | `p2` |
| `partTreePelak` | string | `p3` (note the `Tree`/`Three` typo) |
| `partFourPelak` | string | `p4` |
| `driverTel` | string | `dt` |
| `debitTfCodeRef` | long | `dtfc` |
| `creditTfCodeRef` | long | `ctfc` |
| `debitTf2CodeRef` | long | `dtF2C` |
| `debitTf2CodeLevel` | long | `dtF2L` |
| `creditTf2CodeRef` | long | `ctF2C` |
| `creditTf2CodeLevel` | long | `ctF2L` |
| `weightFreeCar` | long | `wf` |
| `creditInsteadCodeRef` | long | `cic` or `dic` |
| `debitInsteadCodeRef` | long | `dic` or `cic` |
| `accAndReport` | bool | `ar` |

---

## 11. Invoices

### 11.1 `POST /api/v3/Invoice/CreateInvoice`

The largest endpoint. One call can create the invoice header, its line items, an optional waybill (بارنامه), and optional settlement rows — all in one transaction.

Structure:

```
data
├── createuser, createdate, createtime, visitorId, visitorPrice, departmentCode, factNo
└── value[]                    ← invoice headers
    ├── hid, pc, hde, ft, ...  ← header fields
    ├── fd[]                   ← line items (required)
    ├── fb[]                   ← waybill rows (required only for waybill invoices)
    └── fp[]                   ← settlement rows (required only when settling)
```

Top level (`data`):

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `uniqueID` | yes | string | database GUID |
| `data.createuser` | yes | long | Orash user id |
| `data.createdate` | yes | string | Jalali date; the sample writes `"01/08/1400"` but every other endpoint uses `"1400/08/01"` |
| `data.createtime` | yes | string | `"10:31"` |
| `data.visitorId` | no | long | salesperson code |
| `data.visitorPrice` | no | long | salesperson amount |
| `data.departmentCode` | yes | long | branch code |
| `data.factNo` | no | string | client-side invoice number |
| `data.value` | yes | array | invoice headers |

Invoice header (`value[]`):

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `hid` | yes | string | correlation key for `fd`/`fb`/`fp` |
| `pc` | yes | string | account/person code |
| `hde` | no | string | header description |
| `ft` | yes | string | invoice type — see table below |
| `mbl` | no | string | mobile |
| `ins` | no | string | "instead" / بابت code |
| `cn` | no | string | customer name |
| `sf` | no | string | seller's invoice number |
| `t2` | no | string | tafsili 2 code; if supplied it must already exist |
| `sp` | no | string | (undocumented) |
| `dsc` | conditional | string | destination warehouse code — required for stock issue/receipt types; must be an existing warehouse |
| `stp` | no | string | (undocumented) |
| `cc` | no | string | currency code |
| `boc` | no | string | BaseOfCalculate |
| `cr` | no | string | currency rate |
| `ua` | no | string | UserAmount |
| `hsc` | yes | string | warehouse code (header level) |
| `fd` | yes | array | line items |
| `fb` | conditional | array | waybill rows |
| `fp` | conditional | array | settlement rows |

`ft` — invoice type (نوع فاکتور):

| Value | Type |
| --- | --- |
| 0 | sales invoice (فاکتور فروش) |
| 1 | quotation / pre-invoice (پیش فاکتور) |
| 2 | purchase invoice (فاکتور خرید) |
| 3 | sales return (برگشت از فروش) |
| 4 | purchase return (برگشت از خرید) |
| 5 | opening stock (موجودی اول دوره) |
| 7 | warehouse issue (حواله انبار) |
| 8 | warehouse issue return (برگشت از حواله انبار) |
| 11 | warehouse receipt (رسید انبار) |
| 12 | warehouse receipt return (برگشت از رسید انبار) |
| 13 | stock adjustment (اصلاحیه موجودی) |
| 14 | goods order (سفارش کالا) |
| 20 | inter-warehouse transfer (انتقال بین انبار) |

Values 6, 9, 10 and 15–19 are not defined in the document.

Line item (`fd[]`):

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `hid` | yes | string | parent `hid` |
| `iid` | yes | string | row number |
| `gs` | yes | string | goods code |
| `gc` | yes | string | quantity |
| `fp` | yes | string | unit rate (note: the same name `fp` is also the settlement array at header level) |
| `ide` | no | string | row description |
| `upcr` | no | string | packing/category code |
| `upc` | no | string | packing count |
| `ofr` | no | string | row discount amount |
| `op` | no | string | discount percent |
| `tax` | no | string | VAT |
| `pc` | no | string | PriceCalc (note: `pc` at header level means person code) |
| `tas` | no | string | TaxAssignment |
| `per` | no | string | Performance |
| `upC1` | no | string | package count |
| `upC2` | no | string | package quantity |
| `lv` | no | string | length (dimension) |
| `wv` | no | string | width |
| `hv` | no | string | height |
| `cv` | no | string | volume/amount |
| `dv` | no | string | diameter |
| `cfp` | no | string | currency rate |
| `ctp` | no | string | currency amount |
| `cro` | no | string | currency discount |
| `crt` | no | string | currency VAT |
| `itms` | yes | string | warehouse code for the row |

Waybill (`fb[]`) — required only when the invoice carries a waybill. If `hid` is empty the invoice has no waybill.

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `hid` | yes* | string | parent `hid`; empty = no waybill |
| `bid` | yes* | string | waybill row ID |
| `dc` | yes* | string | driver code |
| `wfec` | no | string | empty vehicle weight |
| `wflc` | no | string | loaded vehicle weight |
| `fn` | no | string | weighbridge number |
| `wbb` | no | string | waybill number |
| `dg` | no | string | delivered goods |
| `tfg` | no | string | goods recipient |
| `pos` | no | string | dispatch location |
| `pod` | no | string | delivery location |
| `dbl` | no | string | waybill description |
| `dp` | yes* | string | driver amount |

Settlement (`fp[]`) — required only when settling the invoice inline.

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `hid` | yes* | string | parent `hid` |
| `paid` | yes* | string | settlement identifier |
| `pid` | yes* | string | payer account code |
| `pno` | yes* | string | receipt/POS slip number |
| `pr` | yes* | string | amount |
| `sn` | no | string | serial number |
| `typ` | yes* | string | settlement type |
| `td` | yes* | string | settlement date |
| `ic` | no | string | "instead" / بابت code |
| `tF2C` | no | string | tafsili 2 code |
| `tF2L` | no | string | tafsili 2 name/level |
| `ciD1` | no | string | CR_CurrencyIdref_1 |
| `ciD2` | no | string | CR_CurrencyIdref_2 |
| `cR1` | no | string | CR_Rate_1 |
| `cR2` | no | string | CR_Rate_2 |
| `cV1` | no | string | CR_Value_1 |
| `cV2` | no | string | CR_Value_2 |
| `cst` | no | string | CR_SelectType |

The document never enumerates valid `typ` (settlement type) values. That is a blocking gap for building settlement flows — it has to come from the vendor or the desktop app.

Full request skeleton:

```json
{
  "uniqueID": "string",
  "data": {
    "createuser": 0, "createdate": "string", "createtime": "string",
    "visitorId": 0, "visitorPrice": 0, "departmentCode": 0, "factNo": "string",
    "value": [
      {
        "hid": "string", "pc": "string", "hde": "string", "ft": "string",
        "mbl": "string", "ins": "string", "cn": "string", "sf": "string",
        "t2": "string", "sp": "string", "dsc": "string", "stp": "string",
        "cc": "string", "boc": "string", "cr": "string", "ua": "string",
        "hsc": "string",
        "fd": [
          { "hid": "string", "iid": "string", "gs": "string", "gc": "string", "fp": "string",
            "ide": "string", "upcr": "string", "upc": "string", "ofr": "string", "op": "string",
            "tax": "string", "pc": "string", "tas": "string", "per": "string",
            "upC1": "string", "upC2": "string",
            "lv": "string", "wv": "string", "hv": "string", "cv": "string", "dv": "string",
            "cfp": "string", "ctp": "string", "cro": "string", "crt": "string", "itms": "string" }
        ],
        "fb": [
          { "hid": "string", "bid": "string", "dc": "string", "wfec": "string", "wflc": "string",
            "fn": "string", "wbb": "string", "dg": "string", "tfg": "string",
            "pos": "string", "pod": "string", "dbl": "string", "dp": "string" }
        ],
        "fp": [
          { "hid": "string", "paid": "string", "pid": "string", "pno": "string", "pr": "string",
            "sn": "string", "typ": "string", "td": "string", "ic": "string",
            "tF2C": "string", "tF2L": "string",
            "ciD1": "string", "ciD2": "string", "cR1": "string", "cR2": "string",
            "cV1": "string", "cV2": "string", "cst": "string" }
        ]
      }
    ]
  }
}
```

Success: `content: [{ "content": "71012", "errorCode": 0, "errorMessage": "فاکتور با شماره 71012 درج شد" }]`
Failure example: `errorCode: -1`, `errorMessage: "کد کالا صحيح نيست ."`

### 11.2 `POST /api/v3/Invoice/SearchInvoice`

Searches invoices. All parameters marked required; no data types are given in the source table.

| Field | Required | Meaning |
| --- | --- | --- |
| `uniqueID` | yes | database GUID |
| `data.currentUserID` | yes | acting user id |
| `data.viewDetails` | yes | include line items |
| `data.factType` | yes | invoice type (same enum as `ft`) |
| `data.fyearIdRef` | yes | fiscal year id |
| `data.fromDate` | yes | date from |
| `data.toDate` | yes | date to |
| `data.fromFactNo` | yes | invoice number from |
| `data.toFactNo` | yes | invoice number to |
| `data.fromStorage` | yes | warehouse from |
| `data.toStorage` | yes | warehouse to |
| `data.fromDepartmentCode` | yes | branch from |
| `data.toDepartmentCode` | yes | branch to |
| `data.payAccount` | yes | settlement filter |
| `data.isRegistered` | yes | posted/registered filter |
| `data.isConfirmed` | yes | confirmed filter |

Doc bug: the "Raw (json)" sample under this endpoint is a copy/paste of the `CreateDriver` body (`did`, `code`, `name`, `cm`, `p1`…) and does not match the parameter table. No response schema is documented either. Treat both request sample and response as unverified; confirm against Swagger.

There is also no documented `fyearIdRef` lookup endpoint — no "get fiscal years" service exists in this API.

### 11.3 `POST /api/v3/Invoice/InvoicePayment`

Settles an existing invoice. Same settlement row shape as `CreateInvoice.fp[]`, but keyed to an invoice header id.

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `uniqueID` | yes | string | database GUID |
| `data.createuser` | yes | long | Orash user id |
| `data.createdate` | yes | string | Jalali date |
| `data.createtime` | yes | string | `"10:31"` |
| `data.factHdrId` | yes | long | invoice header id. The PDF labels this "کد ویزیتور" (salesperson code), which is a copy/paste error — the name and position indicate the invoice header id. |
| `data.payNoFlag` | yes | string / bool | client-side settlement-number flag (table says `string`, sample sends `true`) |
| `data.value` | yes | array | settlement rows |
| `value[].paid` | yes | string | client-side settlement number |
| `value[].pid` | yes | string | person/account code |
| `value[].pno` | no | string | POS number |
| `value[].pr` | yes | string | amount |
| `value[].sn` | no | string | serial number |
| `value[].typ` | yes | string | settlement type |
| `value[].td` | yes | string | settlement date |
| `value[].ic` | no | string | "instead" / بابت code |
| `value[].tF2C` | no | string | tafsili 2 code |
| `value[].tF2C2` | no | string | table name; the JSON sample sends `tF2L` instead — treat `tF2L` as authoritative |
| `value[].ciD1` / `ciD2` | no | string | currency codes 1 / 2 |
| `value[].cR1` / `cR2` | no | string | currency rates |
| `value[].cV1` / `cV2` | no | string | currency units |
| `value[].cst` | no | string | CR_SelectType |

```json
{
  "uniqueID": "string",
  "data": {
    "createuser": 0, "createdate": "string", "createtime": "string",
    "factHdrId": 0, "payNoFlag": true,
    "value": [
      { "paid": "string", "pid": "string", "pno": "string", "pr": "string", "sn": "string",
        "typ": "string", "td": "string", "ic": "string",
        "tF2C": "string", "tF2L": "string",
        "ciD1": "string", "ciD2": "string", "cR1": "string", "cR2": "string",
        "cV1": "string", "cV2": "string", "cst": "string" }
    ]
  }
}
```

Success: `content: [{ "content": "71012", "errorCode": 0, "errorMessage": "برگه با شماره 71012 درج شد" }]`
Failure: `errorMessage: "کد شخص صحيح نيست ."`

---

## 12. Reports

### 12.1 `POST /api/v3/RPAccount/GetRPAccount`

Account summary report (گزارش حساب) — one row per account with opening balance, turnover and closing balance.

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `uniqueID` | yes | string | database GUID |
| `data.isPerson` | yes | bool | include persons & other accounts |
| `data.isBank` | yes | bool | include banks |
| `data.isCash` | yes | bool | include cash boxes |
| `data.isTuner` | yes | bool | include petty cash |
| `data.isExpense` | no | bool | include P&L accounts |
| `data.fYearIdRef` | yes | long | fiscal year id |
| `data.fromDate` | yes | string | date from |
| `data.toDate` | yes | string | date to |
| `data.fromPerson` / `toPerson` | no | long | account code range |
| `data.fromMainGroupCode` / `toMainGroupCode` | no | long | account main group range |
| `data.fromSecondGroupCode` / `toSecondGroupCode` | no | long | account sub-group range |
| `data.fromTf2Code` / `toTf2Code` | no | long | cost-centre (tafsili 2) range |
| `data.storage` | no | bool | labelled "currency code 1" in the table, which contradicts the name — pull data from inventory documents is the likely meaning. Unverified. |
| `data.acc` | no | bool | include manually issued accounting vouchers |
| `data.salary` | no | bool | include payroll-subsystem vouchers |
| `data.isViewOrder` | no | bool | include vouchers from orders |
| `data.perType` | no | long | person type filter |
| `data.remainFilter` | no | long | `0` all accounts, `1` with balance, `2` with debit balance, `3` with credit balance |
| `data.transactionFilter` | no | long | `0` with turnover, `1` without turnover, `2` both |
| `data.remainingStatus` | no | long | `0` current balance, `1` current turnover |
| `data.beforeRemain` | no | bool | show brought-forward balance |
| `data.userId` | no | long | user id filter |
| `data.fromMnDef` | no | bool | consider the default cash subsidiary account |
| `data.currentUserID` | no | long | acting user |
| `data.fromDepartmentCode` / `toDepartmentCode` | no | long | branch range |
| `data.departmentAggregation` | no | long | (undocumented) |
| `data.fromInsteadCode` / `toInsteadCode` | no | long / bool | "instead"/بابت code range (`to` is typed `bool` in the table — almost certainly a typo for `long`) |
| `data.profitAndLost` | no | bool* | branch split: `0` per branch, `1` no split, `2` aggregated. Typed `bool` but has three values — treat as `long`. |
| `data.turnOverBeforeRmain` | no | bool* | `0` net turnover, `1` turnover. Same bool/enum mismatch. Misspelling is the wire name. |
| `data.isViewRequest` | no | bool | show request balance |
| `data.fromPerlevel2..7` / `toPerlevel2..7` | no | long | tafsili level 2–7 ranges |

The from/to labels for `Perlevel3` through `Perlevel6` are swapped in the source table (`fromPerlevel3` is described as "to level 3"). Ignore the descriptions and follow the field names.

Response rows:

| Field | Meaning |
| --- | --- |
| `type` | account class (5 = persons in the samples) |
| `perCode` / `perName` | account code / title |
| `address`, `tel`, `mobile` | contact info |
| `sumOldDebit` / `sumOldCredit` | brought-forward debit / credit |
| `sumDebit` / `sumCredit` | period debit / credit |
| `remainSumDebit` / `remainSumCredit` | cumulative debit / credit balance |
| `remainReqPrice` | request balance |
| `remainPrice` | balance amount |
| `remainDebit` / `remainCredit` | closing debit / credit balance |
| `lastOperationDate` | last transaction date |
| `departmentCode` / `departmentName` | branch |

Unlike the other read endpoints, this one's documented response table lists `errorCode` / `errorMessage` at the envelope level, but the actual sample does not include them. The sample envelope is the plain `{ content, message, hasError, responseCode }`.

### 12.2 `POST /api/v3/RPAccount/GetRPAccountDetail`

Account ledger / detail report (گزارش جزییات حساب) — one row per transaction line with running balance.

Field names here are **PascalCase in the parameter table but camelCase in the JSON sample**. Follow the sample.

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `uniqueID` | yes | string | database GUID |
| `data.currentUserID` | yes | long | acting user id |
| `data.transType` | no | long | `1` cash box, `2` bank, `3` petty cash, `4` expense, `5` persons |
| `data.fromPercode` | yes | long | account code from (typed `bool` in the table — typo) |
| `data.toPerCode` | yes | long | account code to (same typo) |
| `data.fromTf2Code` / `toTf2Code` | no | long | cost-centre range |
| `data.fromDate` | yes | string | date from |
| `data.toDate` | yes | string | date to |
| `data.fromDepartmentCode` / `toDepartmentCode` | no | long | branch range |
| `data.fyearID` | no | long | fiscal year id |
| `data.byAcc` | no | bool | include accounting vouchers |
| `data.bySalary` | no | bool | include payroll |
| `data.byStorage` | no | bool | include inventory |
| `data.storageDetail` | no | bool | inventory detail |
| `data.payMultiDetail` | no | bool | multi-payment detail |
| `data.recieveMultiDetail` | no | bool | multi-receipt detail (misspelling is the wire name) |
| `data.saleDetail` | no | bool | sales detail |
| `data.filterRow1` / `filterRow2` | no | string | typed `bool` in the table, sent as `"string"` in the sample |
| `data.byBeforeRemain` | no | bool | include brought-forward balance |
| `data.byOrder` | no | bool / long | orders. The table attaches the `remainFilter` legend (`0` all / `1` with balance / `2` debit / `3` credit) to this field, which looks like a copy/paste error; the sample sends `true`. |
| `data.fromMnDef` | no | bool | default cash subsidiary account |
| `data.userID` | no | long | user id |
| `data.fromInsteadCode` / `toInsteadCode` | no | long | "instead"/بابت range |
| `data.profitAndLost` | no | long | sample sends `0` (number) |
| `data.turnoverType` | no | bool | sample sends `true` |
| `data.recievePayMultiAgg` | no | bool | `0` no receipt/payment aggregation, `1` aggregate |
| `data.showTransAction` | no | bool | show transactions |
| `data.byRequest` | no | bool | request balance |
| `data.fromPerlevel2..7` / `toPerlevel2..7` | no | long | tafsili level 2–7 ranges |

Response rows:

| Field | Meaning |
| --- | --- |
| `pCode` / `pName` / `pType` | reporting account code / name / class |
| `row` | row number (1000, 2000 … in the samples) |
| `factType` | invoice type (`-1` when not invoice-sourced) |
| `type` | source type |
| `detailType` | detail source type |
| `hdrID` | source document header id |
| `transNo` | transaction number |
| `date` | Jalali date, e.g. `"1403/09/11"` |
| `perCode` / `perName` | counterparty account |
| `description` | line description |
| `tf2Code` / `tf2Name` | cost centre |
| `insteadCode` / `insteadName` | بابت code / name |
| `accTf2Code` / `accTf2Name` | voucher cost centre |
| `accInsteadCode` / `accInsteadName` | voucher بابت |
| `debit` / `credit` | amounts |
| `bankSerialNO` | bank serial |
| `address` / `tel` / `mobile` | counterparty contact |
| `detailPrice` | detail amount |
| `detailview` | detail view flag |
| `remain` | running balance |
| `goodsCount` / `fiPrice` | quantity / rate when inventory-sourced |

---

## 13. Gaps and inconsistencies to design around

Collected while reading, in rough order of impact for anything built on top of this API.

**Blocking gaps (not documented anywhere in the PDF):**

1. No response schema for `GetGoods`, `ChangeGoodRate`, or `SearchInvoice`.
2. No enumeration of invoice settlement types (`typ` in `fp[]` / `InvoicePayment`).
3. No lookup endpoints for units, goods main/sub groups, goods categories, goods patterns, account main/sub groups, provinces, cities, visitors, currencies, fiscal years, or "instead"/بابت codes — yet many create calls require those codes and reject bad ones.
4. `SearchInvoice` request sample is wrong (copy of `CreateDriver`).

**Silent-failure trap:** business errors return HTTP 200 with `hasError: false` and `responseCode: 100`. Always inspect `content[].errorCode`, and treat any non-zero value as failure (`CreateRecPay` uses `1`, everything else uses `-1`).

**Field-name mismatches between table and sample (follow the sample):**

| Endpoint | Table says | Sample says |
| --- | --- | --- |
| `GetStorages`, `GetDepartments`, `GetTafsili2` | `createuser` | `userId` |
| `GetGoods` | `currentUSerId` | `currentUserId` |
| `InvoicePayment` | `tF2C2` | `tF2L` |

**Type mismatches between table and sample:** `GetStockStorage` (`goodsCode`/`storageCode` swapped), `CreateRecPay.createUser` (string vs number), `payNoFlag` (string vs bool), `filterRow1/2` (bool vs string), `profitAndLost` and `turnOverBeforeRmain` (bool but three enum values), `toInsteadCode` and `fromPercode`/`toPerCode` (bool but numeric).

**Misspellings that are part of the wire contract — do not "fix" them:** `expence`, `rateDefualt`, `acoountType` (GetCustomer response only), `turnOverBeforeRmain`, `recieveMultiDetail`, `recievePayMultiAgg`, `partTreePelak`, `Tafsili`/`tafsili` casing.

**Overloaded short names inside `CreateInvoice`:** `pc` = person code at header level but PriceCalc on a line item; `fp` = the settlement array at header level but unit rate on a line item. Serializers that flatten these will corrupt payloads.

**Documentation-level slips:** `GetDatabasesInfo` documented GET but sampled POST; `InvoicePayment.factHdrId` mislabelled "salesperson code"; `CreateDriver` labels `p2`/`p3`/`p4` all as "plate part 1"; `GetRPAccount.storage` described as "currency code 1"; `fromPerlevel3..6` from/to descriptions swapped; `CreateGood` input contract published under the "response values" heading; cover revision `3.1.0` vs footer `3.0.1`.

**Date format ambiguity:** everything uses `"1400/08/01"` (`yyyy/MM/dd`) except the `CreateInvoice` example, which shows `"01/08/1400"`. Confirm before posting invoices.

**Operational notes:** all samples are plain HTTP; the JWT appears to last 12 hours (inferred from sample claims); `GET /api/Auth?uniqueID=` enumerates usernames without authentication.

---

*Source: `Orash WEB Service.pdf` (رویه نصب، راه اندازی و بهره برداری از وب سرویس نرم افزار یکپارچه مالی اوراش), واحد تولید و توسعه اوراش, زمستان ۱۴۰۳. Text extracted with `pdftotext -layout`; Persian field descriptions translated and, where the PDF's right-to-left rendering scrambled numbered lists, reconstructed with the ambiguity flagged inline.*
