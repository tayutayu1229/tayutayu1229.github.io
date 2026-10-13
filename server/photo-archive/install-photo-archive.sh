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
install -o root -g root -m 0555 "$HERE/operation_dispatch.py" /opt/tayunet/photo-archive/operation_dispatch.py
install -o root -g root -m 0444 "$HERE/test_photo_archive.py" /opt/tayunet/photo-archive/test_photo_archive.py
install -o root -g root -m 0444 "$HERE/test_operation_dispatch.py" /opt/tayunet/photo-archive/test_operation_dispatch.py
install -o root -g root -m 0755 "$HERE/tayunet-photo-archive" /usr/local/sbin/tayunet-photo-archive
install -o root -g root -m 0644 "$HERE/photo-archive.service" /etc/systemd/system/tayunet-photo-archive.service
install -d -o 1000 -g 1000 -m 0750 \
  /mnt/hdd/tayunet-photo-archive \
  /mnt/hdd/tayunet-photo-archive/shooting-spots \
  /mnt/hdd/tayunet-photo-archive/shooting-spots/originals \
  /mnt/hdd/tayunet-photo-archive/shooting-spots/thumbnails
systemctl daemon-reload
systemctl enable tayunet-photo-archive.service
if systemctl is-active --quiet tayunet-photo-archive.service; then
  # restartはExecStopが先に走るため使わない。稼働中APIを残したままビルド・検査してから入れ替える。
  /usr/local/sbin/tayunet-photo-archive start
else
  systemctl start tayunet-photo-archive.service
fi
systemctl is-enabled --quiet tayunet-photo-archive.service
echo "撮影記録アーカイブAPIを導入しました: http://127.0.0.1:8790/health"
