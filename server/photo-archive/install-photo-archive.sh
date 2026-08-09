#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "sudo sh install-photo-archive.sh で実行してください" >&2
  exit 1
fi

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install -d -o root -g root -m 0755 /opt/tayunet/photo-archive
install -o root -g root -m 0644 "$HERE/requirements.txt" /opt/tayunet/photo-archive/requirements.txt
install -o root -g root -m 0644 "$HERE/Dockerfile" /opt/tayunet/photo-archive/Dockerfile
install -o root -g root -m 0555 "$HERE/photo_archive.py" /opt/tayunet/photo-archive/photo_archive.py
install -o root -g root -m 0444 "$HERE/test_photo_archive.py" /opt/tayunet/photo-archive/test_photo_archive.py
install -o root -g root -m 0755 "$HERE/tayunet-photo-archive" /usr/local/sbin/tayunet-photo-archive
install -o root -g root -m 0644 "$HERE/photo-archive.service" /etc/systemd/system/tayunet-photo-archive.service
systemctl daemon-reload
systemctl enable tayunet-photo-archive.service
systemctl restart tayunet-photo-archive.service
echo "撮影記録アーカイブAPIを導入しました: http://127.0.0.1:8790/health"
