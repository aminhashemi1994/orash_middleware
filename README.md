# Orash panel — QR scanning for ثبت کالا / خدمات

A dependency-free Node server plus a browser panel that builds and submits Orash
web-service requests. On top of the manual `CreateGood` / `CreateInvoice` forms,
goods can be registered by **scanning a QR code** that carries their JSON.

Scan sources, all feeding the same pipeline:

| Source | Needs | Works on |
| --- | --- | --- |
| USB scanner in RS-232 / USB-COM mode (Web Serial) | Chrome or Edge 89+ | Windows 10/11, Linux, macOS, ChromeOS |
| USB scanner in keyboard-wedge (HID) mode | nothing | every browser, every OS |
| This computer's webcam | HTTPS or localhost | every modern browser |
| A phone on the same network | HTTPS (see below) | Android / iOS |
| Pasting the QR text by hand | nothing | everywhere |

```
QR text ─► parse ─► merge with the form's defaults ─► validate ─► queue ─► CreateGood ─► service reply
```

---

## Deploying behind nginx

```bash
sudo ./install.sh                  # service + nginx site for qr.tooscore.ir
sudo ./install.sh --certbot        # …and obtain the certificate
sudo ./install.sh --no-nginx       # service only
./install.sh --run                 # just run it in the foreground, no root
```

The panel is **one Node process** — it serves the front-end from `public/` and
proxies the Orash API. There is no separate backend to start.

The installer writes `.env` from `.env.example` if missing, renders
`deploy/orash-scan.service` into systemd (running as the invoking user, with
`EnvironmentFile=.env`), installs `deploy/nginx/qr.tooscore.ir.conf`, and then
checks that the service actually answers rather than trusting the unit state.
Re-running is safe.

### Configuration

`.env` is read at startup; real environment variables still win, so
`MOCK=1 node server.js` overrides the file. Restart after editing.

| Key | Behind nginx | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | interface to bind — loopback makes the service unreachable except through nginx |
| `PORT` | `4173` | port nginx proxies to |
| `PUBLIC_URL` | `https://qr.tooscore.ir` | **required** when bound to loopback: the phone pairing QR points here |
| `HTTPS` | `0` | nginx terminates TLS, so the built-in listener is off |
| `ORASH_BASE_URL` | — | pre-filled default for the panel's Base URL field |
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
| **روشن** (green, default) | Every scan is validated and sent to `CreateGood` immediately. Scan and move on; the queue shows what the service answered for each one. |
| **خاموش** (grey) | Scans land in the queue as *آماده ثبت* and nothing is sent. Submit with **«ثبت … ردیف در انتظار»**, or the **«ثبت»** button on an individual row. |

The choice is remembered per browser. Either way, a scan whose data is
incomplete is marked *ناقص* and is never sent, and every row keeps its own
**«ثبت»** button so a failed one can be retried after fixing the defaults.

### Ready-made sample QR codes

```bash
npm start                          # then open http://localhost:4173/samples.html
node scripts/make-sample-qr.js     # regenerate after editing the samples
```

Seven QR codes covering every accepted shape — a complete good, a service, Persian
field names with Persian digits, the full `{uniqueID, data}` envelope, a batch of
three in one code, the compact `key=value` form, and a bare product barcode. Each
card shows the JSON it encodes. The same codes are written to `samples/*.png` and
`samples/*.svg` for printing or sending to a phone.

To watch scans land while Orash is unreachable, switch **«ثبت خودکار»** off first:
rows then sit in the queue with their parsed code and name visible and nothing is
sent. With `npm run start:mock` the same codes register successfully — their
reference codes match the simulator.

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

1. Open the panel in Chrome or Edge.
2. Scanner card → **«اتصال به بارکدخوان»** → pick the device in the browser
   dialog (it filters to Datalogic; «انتخاب دستگاه دیگر…» shows all ports).
3. Permission is remembered — later reloads reconnect on their own.

Default baud is 9600 (the Gryphon factory setting); change it in the card if
your device was reprogrammed.

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
lib/self-signed.js         certificate generation
lib/mock-upstream.js       offline Orash simulator (MOCK=1)
public/scan-core.js        QR text -> CreateGood payload (shared with the phone)
public/scan-sources.js     Web Serial, keyboard wedge, camera, phone relay
public/scan-ui.js          scanner card, queue, pairing, sample QR
public/app.js              login, lookups, CreateGood/CreateInvoice forms
public/mobile.html/.js     the phone scanner page
public/styles.css          design system: glass surfaces, motion, device chips
public/vendor/             jsQR (Apache-2.0), qrcode-generator (MIT)
public/vendor/fonts/       Vazirmatn (SIL OFL), served locally so the panel
                           renders correctly on an offline machine
samples/                   generated sample QR codes (PNG + SVG)
scripts/                   Linux serial permission helper
docs/                      reverse-documented API reference
```
