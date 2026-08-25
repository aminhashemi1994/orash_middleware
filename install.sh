#!/usr/bin/env bash
#
# Orash Scan installer.
#
# The panel is ONE Node process: it serves the front-end (public/) and proxies
# the Orash API. There is no separate backend to start.
#
#   sudo ./install.sh                     full install: service + nginx
#   sudo ./install.sh --no-nginx          service only
#   sudo ./install.sh --domain example.ir use another hostname
#   sudo ./install.sh --certbot           also obtain the TLS certificate
#   ./install.sh --run                    just run in the foreground, no sudo
#
# Re-running is safe: every step is idempotent.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN="qr.tooscore.ir"
SERVICE="orash-scan"
WITH_NGINX=1
WITH_CERTBOT=0
RUN_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)    DOMAIN="$2"; shift 2 ;;
    --no-nginx)  WITH_NGINX=0; shift ;;
    --certbot)   WITH_CERTBOT=1; shift ;;
    --run)       RUN_ONLY=1; shift ;;
    -h|--help)   sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '  \033[1;32mok\033[0m   %s\n' "$*"; }
warn() { printf '  \033[1;33mwarn\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERROR\033[0m %s\n' "$*" >&2; exit 1; }

# --------------------------------------------------------------- prerequisites

NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || die "node is not installed. Install Node.js 18 or newer."
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 18 )) || die "Node $NODE_MAJOR is too old; this needs 18 or newer."
ok "node $("$NODE_BIN" -v) at $NODE_BIN"

# ------------------------------------------------------------------------ .env

if [[ ! -f "$APP_DIR/.env" ]]; then
  say "creating .env from .env.example"
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  # Match the requested domain if it is not the default.
  if [[ "$DOMAIN" != "qr.tooscore.ir" ]]; then
    sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://$DOMAIN|" "$APP_DIR/.env"
  fi
  chmod 600 "$APP_DIR/.env"
  ok "wrote $APP_DIR/.env — review it before going live"
else
  ok ".env already exists (left untouched)"
fi

# Read back what the service will actually bind, so the summary cannot lie.
ENV_HOST="$(grep -E '^HOST=' "$APP_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
ENV_PORT="$(grep -E '^PORT=' "$APP_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
ENV_HOST="${ENV_HOST:-0.0.0.0}"
ENV_PORT="${ENV_PORT:-4173}"

# ------------------------------------------------------------------ --run mode

if [[ $RUN_ONLY -eq 1 ]]; then
  say "starting in the foreground (Ctrl+C to stop)"
  cd "$APP_DIR"
  exec "$NODE_BIN" server.js
fi

[[ $EUID -eq 0 ]] || die "installing the service needs root. Run: sudo $0  (or ./install.sh --run to just start it)"

RUN_USER="${SUDO_USER:-root}"
RUN_GROUP="$(id -gn "$RUN_USER")"
ok "service will run as $RUN_USER:$RUN_GROUP"

# ------------------------------------------------------------------- systemd

say "installing systemd unit"
mkdir -p "$APP_DIR/.certs"
chown -R "$RUN_USER:$RUN_GROUP" "$APP_DIR/.certs"

sed -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__NODE_BIN__|$NODE_BIN|g" \
    -e "s|__RUN_USER__|$RUN_USER|g" \
    -e "s|__RUN_GROUP__|$RUN_GROUP|g" \
    "$APP_DIR/deploy/$SERVICE.service" > "/etc/systemd/system/$SERVICE.service"

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
sleep 1.5

if systemctl is-active --quiet "$SERVICE"; then
  ok "$SERVICE is running"
else
  journalctl -u "$SERVICE" -n 20 --no-pager || true
  die "$SERVICE failed to start (log above)"
fi

# Prove it actually answers, rather than trusting the unit state.
PROBE_HOST="$ENV_HOST"
[[ "$PROBE_HOST" == "0.0.0.0" ]] && PROBE_HOST="127.0.0.1"
if command -v curl >/dev/null && curl -fsS -m 5 -o /dev/null "http://$PROBE_HOST:$ENV_PORT/config"; then
  ok "responding on http://$PROBE_HOST:$ENV_PORT"
else
  warn "service is up but did not answer on http://$PROBE_HOST:$ENV_PORT — check: journalctl -u $SERVICE -f"
fi

# --------------------------------------------------------------------- nginx

if [[ $WITH_NGINX -eq 1 ]]; then
  if ! command -v nginx >/dev/null; then
    warn "nginx is not installed; skipping the web front-end"
  else
    say "installing nginx site for $DOMAIN"
    SRC="$APP_DIR/deploy/nginx/qr.tooscore.ir.conf"
    [[ -f "$SRC" ]] || die "missing $SRC"

    mkdir -p /var/www/certbot

    # Debian/Ubuntu use sites-available; RHEL/Arch use conf.d.
    if [[ -d /etc/nginx/sites-available ]]; then
      TARGET="/etc/nginx/sites-available/$DOMAIN"
      LINK="/etc/nginx/sites-enabled/$DOMAIN"
    else
      TARGET="/etc/nginx/conf.d/$DOMAIN.conf"
      LINK=""
    fi

    sed -e "s|qr\.tooscore\.ir|$DOMAIN|g" \
        -e "s|server 127\.0\.0\.1:4173;|server 127.0.0.1:$ENV_PORT;|" \
        "$SRC" > "$TARGET"

    # nginx 1.25.1 deprecated the `listen ... http2` parameter in favour of a
    # standalone directive; older builds do not understand `http2 on;` at all.
    NGINX_VER="$(nginx -v 2>&1 | sed -n 's|.*/\([0-9.]*\).*|\1|p')"
    if [[ -n "$NGINX_VER" ]] && \
       [[ "$(printf '%s\n1.25.1\n' "$NGINX_VER" | sort -V | head -1)" == "1.25.1" ]]; then
      sed -i -e 's|listen 443 ssl http2;|listen 443 ssl;|' \
             -e 's|listen \[::\]:443 ssl http2;|listen [::]:443 ssl;\n    http2 on;|' "$TARGET"
      ok "nginx $NGINX_VER — using the modern http2 directive"
    else
      ok "nginx ${NGINX_VER:-unknown} — using the compatible \`listen ... http2\` form"
    fi

    [[ -n "$LINK" ]] && ln -sfn "$TARGET" "$LINK"
    ok "wrote $TARGET"

    CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
    if [[ ! -s "$CERT_DIR/fullchain.pem" ]]; then
      if [[ $WITH_CERTBOT -eq 1 ]] && command -v certbot >/dev/null; then
        say "obtaining a certificate for $DOMAIN"
        # The :80 block already serves the ACME path, but nginx will not load
        # the :443 block without a cert, so use standalone-free webroot mode
        # against the existing config only if it is already loadable.
        certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email \
          || warn "certbot failed — fix DNS/firewall then re-run: certbot certonly --webroot -w /var/www/certbot -d $DOMAIN"
      else
        warn "no certificate at $CERT_DIR — nginx will not load the HTTPS block yet."
        warn "run:  sudo certbot certonly --webroot -w /var/www/certbot -d $DOMAIN"
        warn "then: sudo nginx -t && sudo systemctl reload nginx"
      fi
    else
      ok "certificate present at $CERT_DIR"
    fi

    if nginx -t 2>/dev/null; then
      systemctl reload nginx
      ok "nginx reloaded"
    else
      warn "nginx config test failed — the site is written but NOT active:"
      nginx -t || true
    fi
  fi
fi

# -------------------------------------------------------------------- summary

cat <<EOF

$(printf '\033[1;32mInstalled.\033[0m')

  service    systemctl status $SERVICE
  logs       journalctl -u $SERVICE -f
  restart    systemctl restart $SERVICE
  config     $APP_DIR/.env          (restart after editing)

  binding    $ENV_HOST:$ENV_PORT
  public     https://$DOMAIN

The panel is a single process serving both the front-end and the API proxy.

Phone scanning needs the public HTTPS address to resolve and the certificate to
be valid — the camera will not open otherwise. Check PUBLIC_URL in .env matches
https://$DOMAIN.
EOF
