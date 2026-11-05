#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/yoshi/.local/bin:/usr/local/bin:/usr/bin:/bin"

MODE="${1:-local}"
MONITOR_DATA="${TAYUNET_MONITOR_DATA:-/home/yoshi/.local/share/tayunet-server-monitor}"
STATUS_FILE="$MONITOR_DATA/backup-status.json"
RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-/home/yoshi/.config/tayunet-server-monitor/restic-password}"
RCLONE_CONFIG="${RCLONE_CONFIG:-/home/yoshi/.config/rclone/rclone.conf}"
LOCAL_REPOSITORY="${LOCAL_REPOSITORY:-/mnt/hdd/tayunet-server-backup}"
CLOUD_REPOSITORY="${CLOUD_REPOSITORY:-rclone:tayunet-drive:tayunet-server-backup}"
LOCK_FILE="$MONITOR_DATA/backup.lock"

mkdir -p "$MONITOR_DATA"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

started="$(date --iso-8601=seconds)"
repository="$LOCAL_REPOSITORY"
[[ "$MODE" == "cloud" ]] && repository="$CLOUD_REPOSITORY"
export RESTIC_PASSWORD_FILE RCLONE_CONFIG RESTIC_REPOSITORY="$repository"
# Restic already selects disposable backup objects; do not leave them using
# the Drive quota in the trash after pruning.
if [[ "$MODE" == "cloud" ]]; then export RCLONE_DRIVE_USE_TRASH=false; fi
RESTIC_COMMAND=(nice -n 10)
if command -v ionice >/dev/null 2>&1; then
  RESTIC_COMMAND+=(ionice -c 2 -n 7)
fi
RESTIC_COMMAND+=(restic)

sources=(
  /mnt/hdd/atos-delay-history
  /mnt/hdd/tayunet-photo-archive
  /home/yoshi/.pm2/dump.pm2
  /home/yoshi/.cloudflared
  /home/yoshi/services/tayunet-server-monitor
)
existing=()
for source in "${sources[@]}"; do [[ -e "$source" ]] && existing+=("$source"); done

detail=""
ok=false
write_status() {
  result=$?
  trap - EXIT
  if [[ "$result" != 0 ]]; then
    ok=false
    detail="${detail:-バックアップが途中で失敗しました（終了コード: $result）}"
  fi
finished="$(date --iso-8601=seconds)"
python3 - "$STATUS_FILE" "$MODE" "$started" "$finished" "$ok" "$detail" <<'PY'
import json, os, sys
path,mode,started,finished,ok,detail=sys.argv[1:]
try:
    data=json.load(open(path))
except Exception:
    data={}
data.update({'configured':True,'lastRun':finished,'ok':ok=='true','detail':detail,'lastMode':mode})
data.setdefault('runs',{})[mode]={'startedAt':started,'finishedAt':finished,'ok':ok=='true','detail':detail}
tmp=path+'.tmp'
with open(tmp,'w') as f: json.dump(data,f,ensure_ascii=False,indent=2)
os.replace(tmp,path)
PY

}
trap write_status EXIT
if [[ ! -s "$RESTIC_PASSWORD_FILE" ]]; then
  detail="restic暗号化キーがありません"
elif ! command -v restic >/dev/null 2>&1; then
  detail="resticがインストールされていません"
elif [[ "$MODE" == "cloud" ]] && ! command -v rclone >/dev/null 2>&1; then
  detail="rcloneがインストールされていません"
else
  if ! output=$("${RESTIC_COMMAND[@]}" snapshots 2>&1); then
    detail="リポジトリの読み取り失敗: $(printf '%s' "$output" | tail -n 12 | tr '\n' ' ')"
    exit 1
  fi
  if [[ "$MODE" == "cloud" ]]; then
    # Failed uploads can leave unreferenced packs. Reclaim them before trying
    # another upload, rather than letting failed attempts accumulate.
    if ! preclean_output=$("${RESTIC_COMMAND[@]}" prune --max-repack-size 0 2>&1); then
      detail="バックアップ開始前の不要データ整理に失敗しました: $(printf '%s' "$preclean_output" | tail -n 12 | tr '\n' ' ')"
      exit 1
    fi
  fi
  if output=$("${RESTIC_COMMAND[@]}" backup --one-file-system --tag "$MODE" --exclude-caches "${existing[@]}" 2>&1); then
    stream_ok=true
    archive_dir="$MONITOR_DATA/container-archives"
    mkdir -p "$archive_dir"
    for item in "incident-share:/data:incident-share-data.tar" "jreast-press-bot-press-release-bot-1:/app/data:press-bot-data.tar"; do
      container="${item%%:*}"; rest="${item#*:}"; container_path="${rest%%:*}"; archive_name="${rest#*:}"
      archive_path="$archive_dir/$archive_name"
      stream_output=""
      if docker cp "$container:$container_path/." - > "$archive_path" && stream_output=$("${RESTIC_COMMAND[@]}" backup "$archive_path" --tag "$MODE" 2>&1); then
        output="$output $stream_output"
      else
        output="$output $stream_output"
        stream_ok=false
      fi
    done
    if [[ "$stream_ok" == true ]]; then
      retention=(--keep-daily 7 --keep-weekly 4 --keep-monthly 6)
      if [[ "$MODE" == "cloud" ]]; then
        retention=(--group-by host,paths --keep-last 2)
      fi
      if ! cleanup_output=$("${RESTIC_COMMAND[@]}" forget --tag "$MODE" "${retention[@]}" --prune 2>&1); then
        detail="バックアップの保存後、古い世代の整理に失敗しました: $(printf '%s' "$cleanup_output" | tail -n 12 | tr '\n' ' ')"
        exit 1
      fi
      detail="$(printf '%s' "$output" | tail -n 12 | tr '\n' ' ')"
      ok=true
    else
      detail="Docker業務データのストリーム取得に失敗: $(printf '%s' "$output" | tail -n 12 | tr '\n' ' ')"
    fi
  else
    detail="$(printf '%s' "$output" | tail -n 12 | tr '\n' ' ')"
  fi
fi


[[ "$ok" == true ]]
