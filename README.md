# Orash panel — QR scanning for ثبت کالا / خدمات

A dependency-free Node server plus a browser panel that builds and submits Orash
web-service requests. On top of the manual `CreateGood` / `CreateInvoice` forms,
goods can be registered by **scanning a QR code** that carries their JSON.

Scan sources, all feeding the same pipeline:

| Source | Needs | Works on |
| --- | --- | --- |
| USB scanner in RS-232 / USB-COM mode, read by the server | nothing in the browser | Linux / macOS server |
| the same scanner via Web Serial, when the server cannot read it | Chrome or Edge 89+ | Windows 10/11, Linux, macOS, ChromeOS |
| USB scanner in keyboard-wedge (HID) mode | nothing | every browser, every OS |
| This computer's webcam | HTTPS or localhost | every modern browser |
| A phone on the same network | HTTPS (see below) | Android / iOS |
| Pasting the QR text by hand | nothing | everywhere |

```
QR text ─► parse ─► merge with the form's defaults ─► validate ─► queue ─► CreateGood ─► service reply
```

---

## Logging in

The panel opens on a **login screen**, and nothing else exists until it is
passed. That is not decoration: this one browser tab holds the token, the
selected database and the form defaults for every scan — the USB scanner, the
webcam and every paired phone all submit through it — so a session has to exist
before any of that is worth showing.

The screen asks for three things: the database, the user, and the password. The
database comes first and full width because everything else depends on it —
picking it is what fills the user list underneath. Both lists are read from the
service, so neither is typed. Press **«ورود»** (or Enter in the password field)
and the dashboard replaces the screen.

The service address is *not* on this screen. It is deployment configuration:
`ORASH_BASE_URL` in `.env`, read by the server and never shown in the panel.

Afterwards the **profile** button at the bottom of the sidebar shows who is
logged in; opening it gives the session read-out — user, database, whether writes
are allowed — and **«خروج از حساب»**, which drops the token and returns to the
login screen. With no token nothing can be submitted, and the scanner says so
instead of failing per scan.

### When Orash is unreachable

The login screen reports it rather than showing empty dropdowns. Node collapses
every network failure into "fetch failed", so the proxy passes the real cause
through and the screen shows it — `ECONNREFUSED`, `EHOSTUNREACH`, or a timeout —
next to the address it tried, with **«ورود»** disabled until the service answers.
Correcting the address retries at once; **«بارگذاری مجدد پایگاه داده‌ها»** retries
on demand.

---

## Deploying behind nginx

Install the dependencies, then run the app with pm2:

```bash
./install.sh                     # deps + .env + nginx site for qr.tooscore.ir
./install.sh --certbot           # …and obtain the certificate
./install.sh --no-nginx          # skip the nginx site

pm2 start ecosystem.config.js    # start it
pm2 save && pm2 startup          # survive a reboot
```

The panel is **one Node process** — it serves the front-end from `public/` and
proxies the Orash API. There is no separate backend to start.

`install.sh` only prepares the machine; it never starts the app. It checks
Node.js, installs pm2 if missing, runs `npm ci`, creates `.env` from
`.env.example` if absent, and installs `deploy/nginx/qr.tooscore.ir.conf`. It
escalates with sudo only for the steps that need it, and re-running is safe.

pm2 reads `ecosystem.config.js`, which runs a **single** fork-mode process: the
scan relay holds pairing sessions in memory, so a second instance would not see
sessions created by the first. Configuration is left to `.env`, which the app
loads itself — pm2 injects nothing, so there is one source of truth.

```
pm2 logs orash-scan       follow the log
pm2 restart orash-scan    after editing .env
pm2 status                is it up
```

### Configuration

`.env` is read at startup; real environment variables still win, so
`MOCK=1 node server.js` overrides the file. Restart after editing.

| Key | Behind nginx | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | interface to bind — loopback makes the service unreachable except through nginx |
| `PORT` | `4173` | port nginx proxies to |
| `PUBLIC_URL` | `https://qr.tooscore.ir` | **required** when bound to loopback: the phone pairing QR points here |
| `HTTPS` | `0` | nginx terminates TLS, so the built-in listener is off |
| `ORASH_BASE_URL` | — | the Orash host; the only place it is set, never shown in the panel |
| `SERIAL_HOST` | `1` | `0` stops the server reading the scanner, leaving the browser path |
| `SERIAL_DEVICE` | auto | pin the scanner's device node |
| `SERIAL_BAUD` | `9600` | scanner line speed |
| `MOCK` | `0` | `1` answers everything from the simulator |
| `ALLOW_PROD_WRITE` | `0` | `1` permits writes to the production database |

`PUBLIC_URL` is not cosmetic: bound to `127.0.0.1`, the LAN address the process
can see is not an address any phone can reach, so pairing would hand out a dead
link. With it set, the pairing QR resolves to the public HTTPS origin — which is
also what the phone camera needs to open at all.

### The nginx site

`deploy/nginx/qr.tooscore.ir.conf` redirects :80 to HTTPS (keeping
`/.well-known/acme-challenge/` reachable so renewals don't need the redirect
lifted), terminates TLS, and proxies to `127.0.0.1:4173`.

One part is load-bearing rather than boilerplate: `/scan/stream` is a
Server-Sent Events endpoint carrying phone scans to the panel, so that location
sets `proxy_buffering off` and a 12-hour read timeout. With default buffering
nginx holds the stream and scans silently never arrive.

The config ships with `listen 443 ssl http2` because `http2 on;` needs nginx
1.25.1+, and Ubuntu 22.04 / Debian 12 ship older builds. `install.sh` detects
the version and rewrites it to the modern form when it can.

---

## Running locally

```bash
npm start              # http://localhost:4173  + https://localhost:4443
npm run start:mock     # same, but answered by a built-in simulator (no Orash needed)
npm run start:http     # skip the HTTPS listener
```

| Env var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4173` | HTTP port |
| `HTTPS_PORT` | `4443` | HTTPS port — the phone camera needs it |
| `HTTPS` | on | `HTTPS=0` disables the TLS listener |
| `TLS_KEY` / `TLS_CERT` | — | use your own certificate instead of the generated one |
| `MOCK` | off | `MOCK=1` answers every call locally; nothing reaches Orash |
| `ALLOW_PROD_WRITE` | off | `ALLOW_PROD_WRITE=1` permits writes to the production database |

`MOCK=1` is the way to try the whole scanning flow while the Orash host is
unreachable. It reproduces the service's envelopes, including the quirk where a
failure still returns HTTP 200 with `hasError: false` and hides the real outcome
in `content[].errorCode`, so success *and* failure paths behave realistically.

---

## What a QR code may contain

The parser is deliberately forgiving. All of these register the same good:

```json
{"code":"71010","name":"کابل ۲.۵","type":1,"serial":"12",
 "unitIdRef":2,"unitPackingCodeRef":1,"mainGroupCodeRef":1,"secondGroupCodeRef":2}
```

```json
{"uniqueID":"…","data":{"code":"71010","name":"کابل ۲.۵", …}}
```

```
code=71010;name=کابل ۲.۵;type=1;unit=2;pack=1;g1=1;g2=2
```

Also accepted:

- **A batch** — `[{…},{…}]` or `{"items":[{…}]}` registers every element in order.
- **Persian field names** — `کد`، `نام کالا`، `نوع`، `سریال`، `کد واحد`، `کد گروه اصلی`، `کد گروه فرعی`، `قیمت` …
- **Persian digits** — `۷۱۰۱۲` is read as `71012`.
- **`type` as a word** — `کالا` / `خدمات` / `good` / `service` instead of `1` / `2`.
- **base64** of any of the above.
- **A bare product barcode** — treated as the goods code; everything else comes
  from the form.

Fields missing from the QR are taken from the **ثبت کالا / خدمات form above the
scanner**, which acts as the defaults (unit, packing, groups, type, serial).
Fill that form once at the start of a session, then just scan.

> Encode your QR codes as **UTF-8**. Many Windows QR generators write Persian in
> a legacy code page; the panel detects that and says so instead of registering a
> corrupted name.

### Auto-submit, or review first

The scanner card's toggle button — **«ثبت خودکار»** — decides what a scan does:

| State | Behaviour |
| --- | --- |
| **خاموش** (grey, default) | Scans land in the queue as *آماده ثبت* and nothing is sent. Submit with **«ثبت … ردیف در انتظار»**, or the **«ثبت»** button on an individual row. |
| **روشن** (green) | Every scan is validated and sent to `CreateGood` immediately. Scan and move on; the queue shows what the service answered for each one. |

It starts **off**, every single time, and is deliberately *not* remembered:
submitting unattended is a decision about the batch in front of the operator, not
a saved preference. A toggle left on last week must not silently register today's
first scan. Turn it on once the QR codes and the form defaults are known to be
right, and the session becomes scan-and-move-on.

Next to it, **«نوشتن اسکن در فرم»** is on by default: each scan's values are
written into the defaults form, so the form always mirrors the last code read. Either way, a scan whose data is
incomplete is marked *ناقص* and is never sent, and every row keeps its own
**«ثبت»** button so a failed one can be retried after fixing the defaults.

### QR لیبل — اکسل صدا می‌زند، پنل می‌سازد

The label workbook issues the label; the panel makes its QR. Excel sends the
three fields its sheet knows and gets a PNG back, which the macro drops on the
sheet:

```
GET /label/qr.png?code=<کد>&serial=<سریال>&name=<عنوان>     the QR, as a PNG
GET /label/qr.svg?…                                          the same, as vectors
GET /label/qr.json?…                                         just the text it encodes
```

```bash
curl -o qr.png "https://qr.tooscore.ir/label/qr.png?code=71501&serial=4554&name=%DA%A9%D8%A7%D8%A8%D9%84"
```

Everything else `CreateGood` demands is fixed in [`lib/label-qr.js`](lib/label-qr.js)
— `type: 1` (کالا) and zeros for the unit, packing and group codes until the
real Orash codes are known. Excel never sees them, so changing them there
changes every label printed afterwards, with nothing to redistribute.

`?scale=` (2–20, default 10) is device pixels per module. The PNG is encoded in
the process — zlib and four chunks — so the server needs no ImageMagick.

**In Excel:** import [`excel/LabelQR.bas`](excel/LabelQR.bas) (VBE → *File →
Import File…*) into the workbook and run `RefreshLabelQR`, or put it behind a
button on the «صدور» sheet. It reads

| Field | Cell |
| --- | --- |
| `code` | `Z3` (the «کدینگ» column) |
| `serial` | `C4` (سریال تولید) |
| `name` | `C5` + `C6` + `D9` (نوع محصول + سایز + رنگ), empty ones skipped |

places the picture over `F7:G10` as a shape named `LABEL_QR`, and replaces that
shape on the next run. The Persian name is percent-encoded from its UTF-8 bytes
through `ADODB.Stream`, because VBA has no encoder of its own and the name
arrives mangled without it. A missing cell comes back as HTTP 400 whose body is
the Persian message the macro shows, so the sheet says which cell is empty
rather than printing a broken label.

**Without Excel:** `node scripts/label-qr.js` reads the same cells straight out
of `نسخه جدید لیبل.xlsm` (an `.xlsm` is a zip of XML, so it is inflated in
place, with no dependencies) and writes `public/label-qr.html` — a printable
card with the QR, the cell each value came from, and the JSON it encodes — plus
`labels/label.svg` and `labels/label.png`. `--json` prints the text and writes
nothing. Both routes go through `lib/label-qr.js`, so they encode the same thing.

### When the certificate expires

An expired certificate must not stop the production line, so the macro treats it
as a warning rather than a wall:

1. it sets `SXH_SERVER_CERT_IGNORE_CERT_DATE_INVALID` on the request, so an
   expired — or not-yet-valid — certificate is accepted;
2. if TLS fails for any other reason, it retries the same request over
   `http://`, which the same server answers;
3. an HTTP status is **not** retried in clear text: that means the panel
   answered and said no, and asking again would get the same no.

Only the date check is waived. A certificate for the wrong host or from an
unknown authority still fails, because those mean something other than the panel
is answering. `TOLERATE_EXPIRED_CERT = False` at the top of the module refuses an
expired one too, and `FALLBACK_URL = ""` turns off the plain-http retry.

That is the client half. The server half is that the certificate should not
expire: `install.sh` now prints its expiry date, warns when no `certbot` timer or
cron is scheduled to renew it, and installs
`/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` — certbot writes the new
file, but nginx keeps serving the one it has in memory until it is reloaded,
which is how a renewed certificate still ends up looking expired.

### When a scanner mangles the Persian

A scanner that reports its data in a single-byte code page turns «کالا» into
`Ú©Ø§Ù„Ø§`, and the JSON stops parsing. `ScanCore.repairMojibake` puts the
bytes back and decodes them as UTF-8 before anything else touches the text —
including before the control characters are stripped, since half of every
mangled Persian letter lands in `0x80-0x9F` and dropping those would make it
unrepairable. Text that was never mangled is left exactly as it came.

What that cannot fix is a scanner in **keyboard-wedge mode**: it sends
keystrokes, which pass through the OS keyboard layout, so with a Persian layout
even `{` and `"` arrive as something else. Switch the layout to English while
scanning, or use the scanner in RS-232 / USB-COM mode, which sends bytes.

### Generating a test QR

The scanner card has **«ساخت QR نمونه از فرم»**: it renders the form's current
values as a QR code on screen. Scan it with the USB scanner or a phone to prove
the whole path works before touching real data.

---

## The USB scanner (Datalogic Gryphon and similar)

The Gryphon in *RS-232 emulation* mode (`05f9:4204`) enumerates as a CDC serial
device — `/dev/ttyACM0` on Linux, a `COM` port on Windows, `/dev/cu.usbmodem*`
on macOS. The panel talks to it through the **Web Serial API**, which behaves
the same on all of them.

**The server reads the device, not the browser.** That is the whole trick, and it
is worth explaining, because the obvious approach does not work: Chrome only
remembers a Web Serial permission for a USB device that reports a serial number.
Handheld scanners — the Gryphon included — generally do not, so Chrome cannot
recognise the same device after a relaunch and puts the port picker up *again*,
every time the browser starts. `requestPort()` is required to be behind a user
gesture, so no page can suppress that.

So `lib/serial-host.js` runs on the panel server, which is on the same machine as
the scanner. It configures the line with `stty`, reads the device node with a
plain `fs` stream, and pushes decoded text to the panel over SSE — the same
transport the paired phones use. No permission dialog, no click, on this start or
any later one. It keeps looking while the port is empty, so plugging the scanner
in is enough; unplugging and replugging reconnects.

The card in **دستگاه‌های اسکن** reports what the server found:

| Situation | The card shows |
| --- | --- |
| the device is open and streaming | *متصل* with the device path — and a note that no browser permission is involved |
| nothing on USB | *دستگاه متصل نیست* — plug it in; picked up within a few seconds, no reload |
| a scanner on USB with no serial port (keyboard/HID mode) | *در حالت صفحه‌کلید* — and the keyboard-wedge source is switched on for you |
| the port exists but its permissions forbid the server's user | the exact owner/mode, plus the command that fixes it |
| another program holds the port | it says so, and the panel falls back to the browser path |

That last row is usually **ModemManager**, which probes every CDC-ACM device it
sees and then holds it. `scripts/linux-serial-access.sh` writes a udev rule that
tells it to leave scanners alone (`ID_MM_DEVICE_IGNORE`), which is the permanent
fix; it also reports whether ModemManager is running and what to do about it.

### The browser fallback

`SERIAL_HOST=0`, Windows, or a port held by something else falls back to Web
Serial in Chrome or Edge 89+. Then the one-time port approval does apply: the
card says *نیازمند تأیید یک‌باره*, **«اتصال»** opens the browser's device picker
(filtered to Datalogic; «دستگاه دیگر…» shows all ports), and the grant lasts as
long as Chrome chooses to remember it — see above for why that may be only until
the browser restarts.

Default baud is 9600 (the Gryphon factory setting); change it in the card if your
device was reprogrammed — a connected port is reopened at the new speed at once.
For the server-side reader, set `SERIAL_BAUD` (and `SERIAL_DEVICE` to pin the
node instead of auto-detecting).

On a phone the USB card is hidden entirely: a phone scans with its camera, and
there is no device to attach.

### Linux: one-time permission setup

`/dev/ttyACM0` is `root:uucp` by default, so Chrome cannot open it:

```bash
sudo ./scripts/linux-serial-access.sh
```

It installs `/etc/udev/rules.d/70-orash-barcode-scanner.rules`, tagging the
device `uaccess` so it is handed to the logged-in desktop session, and adds you
to `uucp`/`dialout` as a fallback. Unplug and replug the scanner afterwards.

The rule number matters: systemd's `73-seat-late.rules` is what applies the
`uaccess` ACL, and udev evaluates rule files in order, so a rule numbered above
73 adds the tag too late to have any effect.

If the group fallback is what ends up granting access, **log out and back in** —
group membership is fixed at session start, so a session opened before the script
ran still cannot see the device.

**When "اتصال ناموفق" appears**, the panel asks the server to inspect the device
and reports the real cause — missing device, wrong permissions, a group that
needs a fresh login, or another program holding the port — because the browser
itself only ever says "Failed to open serial port".

Windows and macOS need nothing; Windows may fetch a USB-COM driver on first plug.

### If Web Serial is unavailable (Firefox, Safari)

Reprogram the scanner to **USB keyboard / HID** mode with the barcode in its
product manual, then tick **«گوش دادن به بارکدخوان صفحه‌کلیدی»**. The panel
identifies a scanner by typing speed — a burst of fast keystrokes ending in
Enter — so your own typing in the form is never captured.

---

## Scanning with a phone

The phone never talks to Orash. It decodes the QR and sends the text to the
panel, which owns the login token and the form defaults and performs the
`CreateGood` call, then pushes the result back to the phone. One queue, one
audit trail, no credentials on the phone.

1. Scanner card → **«نمایش QR اتصال گوشی»**.
2. Scan that QR with the phone's camera and open the link (or browse to the
   panel's `/mobile.html` and type the 6-digit code).
3. Tap **«شروع اسکن»** and scan goods. Each one appears in the panel's queue and
   the phone shows what the service answered.

### Why HTTPS

Browsers only grant camera access in a *secure context*, and
`http://192.168.x.x:4173` is not one. The server therefore generates a
self-signed certificate at startup (via `openssl`, present on Linux/macOS and
shipped with Git for Windows) and also listens on **4443**. The pairing QR points
at the HTTPS address.

The phone will warn that the certificate is not trusted — tap *Advanced →
Proceed*. The camera works after that. To avoid the warning, install
`.certs/cert.pem` on the phone as a trusted certificate, or supply a real one
through `TLS_KEY` / `TLS_CERT`.

If `openssl` is missing the panel says so and falls back to HTTP, where phone
camera scanning cannot work — but the phone's manual-entry box still does.

---

## Safety

- The dashboard is behind a login screen; with no token the scanner refuses to
  queue anything and says why.
- Only whitelisted upstream paths are reachable through the proxy.
- Writes to the production database are refused unless `ALLOW_PROD_WRITE=1`;
  the scanner respects the same gate and refuses to queue anything.
- Incomplete scans are held in the queue as ناقص and never sent.
- Codes are submitted one at a time, in scan order.
- Repeats of the same code within a short window are ignored, so a code left in
  the camera's view is not registered over and over.

---

## Layout

```
server.js                  proxy, static files, HTTPS, scan relay
lib/scan-relay.js          phone <-> panel pairing over Server-Sent Events
lib/serial-host.js         reads the USB scanner on the server, streams to the panel
lib/serial-check.js        what is plugged in, and why a port will not open
lib/self-signed.js         certificate generation
lib/mock-upstream.js       offline Orash simulator (MOCK=1)
public/scan-core.js        QR text -> CreateGood payload (shared with the phone)
public/scan-sources.js     Web Serial, keyboard wedge, camera, phone relay
public/scan-ui.js          scanner card, queue, pairing, on-screen QR
public/app.js              login gate, lookups, CreateGood/CreateInvoice forms
public/mobile.html/.js     the phone scanner page
public/styles.css          design system: glass surfaces, motion, device chips
public/vendor/             jsQR (Apache-2.0), qrcode-generator (MIT)
public/vendor/fonts/       Vazirmatn (SIL OFL), served locally so the panel
                           renders correctly on an offline machine
lib/label-qr.js            the label's JSON, its QR, and a PNG encoder
excel/LabelQR.bas          the VBA that calls /label/qr.png and places it
labels/                    the label QR generated from the workbook (SVG + PNG)
scripts/label-qr.js        the same QR, built offline from نسخه جدید لیبل.xlsm
scripts/                   Linux serial permission helper
docs/                      reverse-documented API reference
```
