#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends smartmontools fail2ban traceroute

install -o root -g root -m 0644 "$SOURCE_DIR/tayunet-sshd.local" /etc/fail2ban/jail.d/tayunet-sshd.local
install -o root -g root -m 0440 "$SOURCE_DIR/tayunet-monitor-sudoers" /etc/sudoers.d/tayunet-monitor
visudo -cf /etc/sudoers.d/tayunet-monitor

systemctl enable --now smartmontools.service 2>/dev/null || true
systemctl enable --now fail2ban.service
systemctl restart fail2ban.service

echo "SMART・fail2ban・ネットワーク経路診断の導入が完了しました。"
