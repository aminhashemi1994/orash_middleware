#!/usr/bin/env bash
# Grant the desktop user access to a USB barcode scanner running in RS-232 /
# USB-COM mode, so Chrome's Web Serial API can open it.
#
# Only needed on Linux. Windows and macOS hand the port to the logged-in user
# already (Windows may ask for the vendor's USB-COM driver on first plug).
#
# Run:  sudo ./scripts/linux-serial-access.sh
set -euo pipefail

# The number matters. systemd's 73-seat-late.rules is what actually applies the
# uaccess ACL, and udev evaluates rule files in lexical order — a rule numbered
# above 73 adds the tag too late to have any effect.
RULE_FILE=/etc/udev/rules.d/70-orash-barcode-scanner.rules
STALE_RULE=/etc/udev/rules.d/99-orash-barcode-scanner.rules
TARGET_USER="${SUDO_USER:-$USER}"

if [[ $EUID -ne 0 ]]; then
  echo "This script needs root. Run: sudo $0" >&2
  exit 1
fi

echo "== detected scanners =="
found=0
for dev in /dev/ttyACM* /dev/ttyUSB*; do
  [[ -e "$dev" ]] || continue
  found=1
  group=$(stat -c '%G' "$dev")
  echo "  $dev  (group: $group, mode: $(stat -c '%A' "$dev"))"
done
[[ $found -eq 1 ]] || echo "  none plugged in right now (the rule below still applies once you plug one in)"

# uaccess hands the device to whoever is logged in at the seat, which survives
# reboots and needs no group membership or re-login.
cat > "$RULE_FILE" <<'RULES'
# Orash panel - USB barcode scanners in RS-232 / USB-COM (CDC-ACM) mode.
# TAG+="uaccess" gives the active desktop session an ACL on the device, which is
# what Chrome's Web Serial API needs.

#
# ID_MM_DEVICE_IGNORE keeps ModemManager off the port. It probes every CDC-ACM
# device it sees on plug, and while it holds the port nothing else can open it:
# the panel server gets "Device or resource busy" and Chrome gets its unhelpful
# "Failed to open serial port".

# Datalogic / PSC Scanning (Gryphon and friends)
SUBSYSTEM=="tty", ATTRS{idVendor}=="05f9", MODE="0660", GROUP="uucp", TAG+="uaccess", ENV{ID_MM_DEVICE_IGNORE}="1"

# Common alternatives, harmless if you do not own one:
SUBSYSTEM=="tty", ATTRS{idVendor}=="0c2e", MODE="0660", GROUP="uucp", TAG+="uaccess", ENV{ID_MM_DEVICE_IGNORE}="1"  # Honeywell/Metrologic
SUBSYSTEM=="tty", ATTRS{idVendor}=="1eab", MODE="0660", GROUP="uucp", TAG+="uaccess", ENV{ID_MM_DEVICE_IGNORE}="1"  # Newland
SUBSYSTEM=="tty", ATTRS{idVendor}=="23d0", MODE="0660", GROUP="uucp", TAG+="uaccess", ENV{ID_MM_DEVICE_IGNORE}="1"  # Zebra/Symbol
SUBSYSTEM=="tty", ATTRS{idVendor}=="05e0", MODE="0660", GROUP="uucp", TAG+="uaccess", ENV{ID_MM_DEVICE_IGNORE}="1"  # Symbol/Zebra
SUBSYSTEM=="tty", ATTRS{idVendor}=="0536", MODE="0660", GROUP="uucp", TAG+="uaccess", ENV{ID_MM_DEVICE_IGNORE}="1"  # Honeywell HHP
RULES
echo
echo "wrote $RULE_FILE"

if [[ -e "$STALE_RULE" ]]; then
  rm -f "$STALE_RULE"
  echo "removed $STALE_RULE (numbered too high to grant the uaccess ACL)"
fi

# Belt and braces: group membership covers non-seat logins (ssh, kiosk services).
for g in uucp dialout; do
  if getent group "$g" >/dev/null && ! id -nG "$TARGET_USER" | grep -qw "$g"; then
    usermod -aG "$g" "$TARGET_USER"
    echo "added $TARGET_USER to group $g"
  fi
done

udevadm control --reload-rules
udevadm trigger --subsystem-match=tty --action=add
udevadm settle || true

echo
echo "== result =="
for dev in /dev/ttyACM* /dev/ttyUSB*; do
  [[ -e "$dev" ]] || continue
  if sudo -u "$TARGET_USER" test -r "$dev" && sudo -u "$TARGET_USER" test -w "$dev"; then
    echo "  OK    $dev is readable/writable by $TARGET_USER"
  else
    echo "  STILL DENIED  $dev"
    echo "         ACL: $(getfacl -p "$dev" 2>/dev/null | tr '\n' ' ')"
    echo "         Unplug and replug the scanner. If it stays denied, log out and"
    echo "         back in — the $TARGET_USER group membership needs a fresh session."
  fi
done
# ModemManager only re-reads the ignore property when the device is re-added, and
# it keeps any port it already grabbed. Say so plainly rather than leaving the
# operator with a port that is readable but still "busy".
if systemctl is-active --quiet ModemManager 2>/dev/null; then
  echo
  echo "== ModemManager =="
  echo "  It is running. The rule above tells it to ignore these scanners, but a"
  echo "  port it already holds stays held until the device is re-added:"
  echo "      unplug and replug the scanner   (enough in almost every case)"
  echo "  If a port keeps coming back busy, and you have no cellular modem:"
  echo "      sudo systemctl disable --now ModemManager"
fi

echo
echo "Then restart the panel (npm start). It takes the scanner by itself —"
echo "no browser permission, no click."
