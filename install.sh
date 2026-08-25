#!/usr/bin/env bash
#
# Orash Scan — dependency installer.
#
# This script ONLY prepares the machine. It does not start the app: pm2 does
# that, and the command is printed at the end.
#
# What it does:
#   - checks Node.js
#   - installs pm2 if missing
#   - runs npm install (the app has no runtime dependencies; this keeps a
#     lockfile-driven install honest if any are ever added)
#   - creates .env from .env.example if missing
#   - installs the nginx site for the domain, unless --no-nginx
#
#   ./install.sh                      prepare everything (sudo used only where needed)
#   ./install.sh --no-nginx           skip the nginx site
#   ./install.sh --domain example.ir  use another hostname
#   ./install.sh --certbot            also obtain the TLS certificate
#
# Re-running is safe: every step is idempotent.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN="qr.tooscore.ir"
WITH_NGINX=1
WITH_CERTBOT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)   DOMAIN="$2"; shift 2 ;;
    --no-nginx) WITH_NGINX=0; shift ;;
    --certbot)  WITH_CERTBOT=1; shift ;;
    -h|--help)  sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '  \033[1;32mok\033[0m   %s\n' "$*"; }
warn() { printf '  \033[1;33mwarn\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERROR\033[0m %s\n' "$*" >&2; exit 1; }

# Only escalate for the steps that genuinely need it.
SUDO=""
if [[ $EUID -ne 0 ]]; then
  command -v sudo >/dev/null && SUDO="sudo"
fi
need_root() {
  [[ $EUID -eq 0 || -n "$SUDO" ]] || die "$1 needs root, and sudo is not available."
}

# ------------------------------------------------------------------- Node.js

say "checking Node.js"
NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || die "node is not installed. Install Node.js 18 or newer, then re-run."
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 18 )) || die "Node $NODE_MAJOR is too old; this needs 18 or newer."
ok "node $("$NODE_BIN" -v)"

# ------------------------------------------------------------- app packages

say "installing app dependencies"
if [[ -f "$APP_DIR/package-lock.json" ]]; then
  ( cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund ) && ok "npm ci"
else
  ( cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund ) >/dev/null && ok "npm install (no runtime dependencies — nothing to fetch)"
fi

# ------------------------------------------------------------------------ pm2

say "checking pm2"
PM2_READY=1
if command -v pm2 >/dev/null; then
  ok "pm2 $(pm2 -v 2>/dev/null | tail -1) already installed"
else
  NPM_PREFIX="$(npm config get prefix 2>/dev/null || echo /usr)"
  warn "pm2 not found — installing globally into $NPM_PREFIX"

  # Writing to a root-owned prefix (/usr on most distros) needs escalation.
  # Try unprivileged first so a user-owned prefix, nvm or fnm just works.
  PM2_LOG="$(mktemp)"
  if npm install -g pm2 >"$PM2_LOG" 2>&1; then
    ok "pm2 installed"
  elif [[ -n "$SUDO" ]] && $SUDO npm install -g pm2 >"$PM2_LOG" 2>&1; then
    ok "pm2 installed (via sudo)"
  else
    PM2_READY=0
    warn "could not install pm2 automatically. Last error:"
    tail -4 "$PM2_LOG" | sed 's/^/       /'
    warn "install it yourself, then re-run nothing — the rest of this script has still done its job:"
    warn "       sudo npm install -g pm2"
  fi
  rm -f "$PM2_LOG"
fi

mkdir -p "$APP_DIR/logs"
ok "log directory $APP_DIR/logs"

# ------------------------------------------------------------------------ .env

say "configuration"
if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  if [[ "$DOMAIN" != "qr.tooscore.ir" ]]; then
    sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://$DOMAIN|" "$APP_DIR/.env"
  fi
  chmod 600 "$APP_DIR/.env"
  ok "created .env from .env.example — review it before going live"
else
  ok ".env already exists (left untouched)"
fi

read_env() { grep -E "^$1=" "$APP_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"' " ; }
ENV_HOST="$(read_env HOST)"; ENV_HOST="${ENV_HOST:-0.0.0.0}"
ENV_PORT="$(read_env PORT)"; ENV_PORT="${ENV_PORT:-4173}"
ENV_PUBLIC="$(read_env PUBLIC_URL)"
ok "will bind $ENV_HOST:$ENV_PORT"

if [[ "$ENV_HOST" =~ ^(127\.0\.0\.1|localhost|::1)$ && -z "$ENV_PUBLIC" ]]; then
  warn "HOST is loopback but PUBLIC_URL is empty — phone pairing will have no address to hand out."
fi

# ---------------------------------------------------------------------- nginx

if [[ $WITH_NGINX -eq 1 ]]; then
  say "nginx site for $DOMAIN"
  if ! command -v nginx >/dev/null; then
    warn "nginx is not installed; skipping. Install it and re-run, or use --no-nginx."
  else
    need_root "installing the nginx site"
    SRC="$APP_DIR/deploy/nginx/qr.tooscore.ir.conf"
    [[ -f "$SRC" ]] || die "missing $SRC"

    $SUDO mkdir -p /var/www/certbot

    if [[ -d /etc/nginx/sites-available ]]; then
      TARGET="/etc/nginx/sites-available/$DOMAIN"; LINK="/etc/nginx/sites-enabled/$DOMAIN"
    else
      TARGET="/etc/nginx/conf.d/$DOMAIN.conf"; LINK=""
    fi

    sed -e "s|qr\.tooscore\.ir|$DOMAIN|g" \
        -e "s|server 127\.0\.0\.1:4173;|server 127.0.0.1:$ENV_PORT;|" \
        "$SRC" | $SUDO tee "$TARGET" >/dev/null

    # nginx 1.25.1 deprecated the `listen ... http2` parameter in favour of a
    # standalone directive; older builds do not understand `http2 on;` at all.
    NGINX_VER="$(nginx -v 2>&1 | sed -n 's|.*/\([0-9.]*\).*|\1|p')"
    if [[ -n "$NGINX_VER" ]] && \
       [[ "$(printf '%s\n1.25.1\n' "$NGINX_VER" | sort -V | head -1)" == "1.25.1" ]]; then
      $SUDO sed -i -e 's|listen 443 ssl http2;|listen 443 ssl;|' \
                   -e 's|listen \[::\]:443 ssl http2;|listen [::]:443 ssl;\n    http2 on;|' "$TARGET"
      ok "nginx $NGINX_VER — modern http2 directive"
    else
      ok "nginx ${NGINX_VER:-unknown} — compatible \`listen ... http2\` form"
    fi

    [[ -n "$LINK" ]] && $SUDO ln -sfn "$TARGET" "$LINK"
    ok "wrote $TARGET"

    CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
    if [[ ! -s "$CERT_DIR/fullchain.pem" ]]; then
      if [[ $WITH_CERTBOT -eq 1 ]] && command -v certbot >/dev/null; then
        $SUDO certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
          --non-interactive --agree-tos --register-unsafely-without-email \
          || warn "certbot failed — fix DNS/firewall, then re-run it by hand"
      else
        warn "no certificate at $CERT_DIR — nginx will not load the HTTPS block yet."
        warn "run:  sudo certbot certonly --webroot -w /var/www/certbot -d $DOMAIN"
      fi
    else
      ok "certificate present"
    fi

    if $SUDO nginx -t >/dev/null 2>&1; then
      $SUDO systemctl reload nginx && ok "nginx reloaded"
    else
      warn "nginx config test failed — site written but NOT active:"
      $SUDO nginx -t || true
    fi
  fi
fi

# -------------------------------------------------------------------- summary

G=$'\033[1;32m'; B=$'\033[1m'; D=$'\033[0m'

if [[ $PM2_READY -eq 0 ]]; then
  cat <<EOF

${G}Everything except pm2 is ready.${D} Install pm2 first:

  ${B}sudo npm install -g pm2${D}

then start the service:
EOF
else
  cat <<EOF

${G}Dependencies ready.${D} Nothing is running yet — start it with pm2:
EOF
fi

cat <<EOF

  ${B}cd $APP_DIR${D}
  ${B}pm2 start ecosystem.config.js${D}

Then, to survive a reboot:

  ${B}pm2 save${D}
  ${B}pm2 startup${D}          # prints a command to run once with sudo

Day to day:

  pm2 logs orash-scan          follow the log
  pm2 restart orash-scan       after editing .env
  pm2 status                   is it up
  pm2 stop orash-scan          stop it

Config   $APP_DIR/.env   (read by the app itself, not by pm2)
Binding  $ENV_HOST:$ENV_PORT
Public   ${ENV_PUBLIC:-（not set）}

The panel is a single process serving both the front-end and the API proxy.
EOF
