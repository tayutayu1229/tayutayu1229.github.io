#!/usr/bin/env python3
"""TAYUNET 撮影記録アーカイブ API。

写真本体とサムネイルはUbuntu HDD、検索・共有索引は同じHDD上のSQLiteへ保存する。
Firebaseのパスワードは受け取らず、ブラウザが発行したIDトークンだけを検証する。
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import secrets
import shutil
import sqlite3
import tempfile
import time
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any

import httpx
import jwt
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.background import BackgroundTask
from PIL import ExifTags, Image, ImageOps
from operation_dispatch import register_operation_dispatch

ROOT = Path(os.getenv("PHOTO_ARCHIVE_ROOT", "/data")).resolve()
DB_PATH = Path(os.getenv("PHOTO_ARCHIVE_DB", str(ROOT / "archive.sqlite3"))).resolve()
ORIGINALS = ROOT / "originals"
THUMBNAILS = ROOT / "thumbnails"
EXPORTS = ROOT / "exports"
PROJECT_ID = os.getenv("PHOTO_ARCHIVE_FIREBASE_PROJECT", "tokyo-pass")
HOST = os.getenv("PHOTO_ARCHIVE_HOST", "0.0.0.0")
PORT = int(os.getenv("PHOTO_ARCHIVE_PORT", "8790"))
TRASH_DAYS = max(1, int(os.getenv("PHOTO_ARCHIVE_TRASH_DAYS", "30")))
MAX_UPLOAD_BYTES = max(1, int(os.getenv("PHOTO_ARCHIVE_MAX_UPLOAD_MB", "100"))) * 1024 * 1024
MANAGER_EMAILS = {
    "admin@tayunet-traininfo.com",
    "systemadmin@tayunet-traininfo.com",
}
ALLOWED_ORIGINS = [value.strip() for value in os.getenv(
    "PHOTO_ARCHIVE_ALLOWED_ORIGINS",
    "https://tayunet-traininfo.com,https://www.tayunet-traininfo.com",
).split(",") if value.strip()]
JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
ISSUER = f"https://securetoken.google.com/{PROJECT_ID}"
JWK_CLIENT = jwt.PyJWKClient(JWK_URL, cache_keys=True, lifespan=3600)
JST = timezone(timedelta(hours=9))

PHOTO_FIELDS = (
    "title", "category", "capturedAt", "location", "station", "latitude", "longitude",
    "trainNumber", "origin", "destination", "trainType", "serviceDate", "changes",
    "transportRoute", "article", "notes", "camera", "lens", "shutterSpeed", "aperture",
    "iso", "focalLength", "visibility", "allowedUids", "allowedGroupIds", "tags", "albumIds",
)
VISIBILITIES = {"private", "users", "link", "public"}

app = FastAPI(title="TAYUNET Photo Archive / Operation Dispatch", version="2026.08.11.4")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Share-Password"],
    expose_headers=["Content-Disposition"],
)


def now_iso() -> str:
    return datetime.now(JST).isoformat(timespec="seconds")


def normalized_expiry(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=JST)
        return parsed.astimezone(JST).isoformat(timespec="seconds")
    except ValueError as error:
        raise HTTPException(400, "有効期限の形式が不正です") from error


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def initialize() -> None:
    for folder in (ROOT, ORIGINALS, THUMBNAILS, EXPORTS):
        folder.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users (
          uid TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', last_seen_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS photos (
          id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL, owner_email TEXT NOT NULL,
          filename TEXT NOT NULL, mime TEXT NOT NULL, original_path TEXT NOT NULL, thumbnail_path TEXT NOT NULL,
          byte_size INTEGER NOT NULL, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0,
          checksum TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'other',
          captured_at TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', station TEXT NOT NULL DEFAULT '',
          latitude REAL, longitude REAL, train_number TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT '',
          destination TEXT NOT NULL DEFAULT '', train_type TEXT NOT NULL DEFAULT '', service_date TEXT NOT NULL DEFAULT '',
          changes TEXT NOT NULL DEFAULT '', transport_route TEXT NOT NULL DEFAULT '', article TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '', camera TEXT NOT NULL DEFAULT '', lens TEXT NOT NULL DEFAULT '',
          shutter_speed TEXT NOT NULL DEFAULT '', aperture TEXT NOT NULL DEFAULT '', iso TEXT NOT NULL DEFAULT '',
          focal_length TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]',
          visibility TEXT NOT NULL DEFAULT 'private', allowed_uids_json TEXT NOT NULL DEFAULT '[]',
          allowed_group_ids_json TEXT NOT NULL DEFAULT '[]', deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_photos_owner ON photos(owner_uid, deleted_at, captured_at);
        CREATE INDEX IF NOT EXISTS idx_photos_visibility ON photos(visibility, deleted_at);
        CREATE TABLE IF NOT EXISTS albums (
          id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
          visibility TEXT NOT NULL DEFAULT 'private', allowed_uids_json TEXT NOT NULL DEFAULT '[]',
          allowed_group_ids_json TEXT NOT NULL DEFAULT '[]', cover_photo_id TEXT, deleted_at TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS album_photos (
          album_id TEXT NOT NULL, photo_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(album_id, photo_id)
        );
        CREATE TABLE IF NOT EXISTS shares (
          id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
          token_hash TEXT UNIQUE NOT NULL, password_salt TEXT, password_hash TEXT, expires_at TEXT,
          created_at TEXT NOT NULL, revoked_at TEXT
        );
        CREATE TABLE IF NOT EXISTS friends (
          low_uid TEXT NOT NULL, high_uid TEXT NOT NULL, requested_by TEXT NOT NULL,
          status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          PRIMARY KEY(low_uid, high_uid)
        );
        CREATE TABLE IF NOT EXISTS groups (
          id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS group_members (
          group_id TEXT NOT NULL, uid TEXT NOT NULL, PRIMARY KEY(group_id, uid)
        );
        """)


initialize()


def json_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return list(dict.fromkeys(str(item).strip() for item in value if str(item).strip()))[:200]


def parse_json_list(value: str | None) -> list[str]:
    try:
        return json_list(json.loads(value or "[]"))
    except (TypeError, json.JSONDecodeError):
        return []


def field(document: dict[str, Any], name: str) -> Any:
    value = document.get("fields", {}).get(name, {})
    for kind in ("booleanValue", "stringValue", "integerValue", "doubleValue"):
        if kind in value:
            return value[kind]
    return None


def is_manager(user: dict[str, Any]) -> bool:
    return str(user.get("email") or "").casefold() in MANAGER_EMAILS


async def active_firestore_profile(uid: str, token: str) -> dict[str, Any]:
    """Load one approved Firebase profile using the caller's ID token."""
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/users/{uid}"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    except Exception as error:
        raise HTTPException(503, "利用者情報を確認できません") from error
    if response.status_code == 404:
        raise HTTPException(404, "Firebaseに利用者が見つかりません")
    if response.status_code != 200:
        raise HTTPException(503, "Firebaseの利用者情報を確認できません")
    profile = response.json()
    active = field(profile, "approved") is True and field(profile, "status") == "active" and field(profile, "disabled") is not True
    if not active:
        raise HTTPException(403, "利用承認済みのアカウントが必要です")
    return profile


async def active_directory_profile(uid: str, token: str) -> dict[str, Any]:
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/photo_member_directory/{uid}"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    except Exception as error:
        raise HTTPException(503, "共有利用者情報を確認できません") from error
    if response.status_code == 404:
        raise HTTPException(404, "Firebaseに共有可能な利用者が見つかりません")
    if response.status_code != 200:
        raise HTTPException(503, "Firebaseの共有利用者情報を確認できません")
    profile = response.json()
    if field(profile, "active") is not True:
        raise HTTPException(403, "現在共有できないアカウントです")
    return profile


async def verify_user(authorization: Annotated[str | None, Header()] = None) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Firebaseログインが必要です")
    token = authorization[7:].strip()
    try:
        signing_key = JWK_CLIENT.get_signing_key_from_jwt(token)
        claims = jwt.decode(token, signing_key.key, algorithms=["RS256"], audience=PROJECT_ID, issuer=ISSUER)
    except Exception as error:
        raise HTTPException(401, "Firebase認証を確認できません") from error
    uid = str(claims.get("sub") or "")
    email = str(claims.get("email") or "")
    if not uid:
        raise HTTPException(401, "Firebase UIDがありません")
    profile = await active_firestore_profile(uid, token)
    display_name = str(field(profile, "displayName") or claims.get("name") or email.split("@")[0]).strip()[:200]
    with connect() as db:
        db.execute("""INSERT INTO users(uid,email,display_name,last_seen_at) VALUES(?,?,?,?)
          ON CONFLICT(uid) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,last_seen_at=excluded.last_seen_at""", (uid, email, display_name, now_iso()))
    role = "manager" if email.casefold() in MANAGER_EMAILS else "contributor"
    return {"uid": uid, "email": email, "role": role, "canUpload": role == "contributor", "canManage": role == "manager", "_token": token}


def require_contributor(user: dict[str, Any] = Depends(verify_user)) -> dict[str, Any]:
    if is_manager(user):
        raise HTTPException(403, "管理用アカウントから写真やアルバムは登録できません")
    return user


OPERATION_DISPATCH = register_operation_dispatch(app, verify_user, ROOT / "operation-dispatch.sqlite3")


def can_manage(row: sqlite3.Row, user: dict[str, Any]) -> bool:
    return is_manager(user) or row["owner_uid"] == user["uid"]


def rational_text(value: Any) -> str:
    try:
        numerator = float(value.numerator)
        denominator = float(value.denominator)
        if not denominator:
            return ""
        decimal = numerator / denominator
        if 0 < decimal < 0.01 and numerator.is_integer() and denominator.is_integer():
            return f"{int(numerator)}/{int(denominator)}"
        return str(int(decimal)) if decimal.is_integer() else f"{decimal:.2f}".rstrip("0").rstrip(".")
    except (AttributeError, TypeError, ValueError, ZeroDivisionError):
        return str(value or "")


def gps_decimal(values: Any, ref: str) -> float | None:
    try:
        degrees, minutes, seconds = (float(item) for item in values)
        result = degrees + minutes / 60 + seconds / 3600
        return -result if ref in {"S", "W"} else result
    except (TypeError, ValueError):
        return None


def image_metadata(path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {}
    with Image.open(path) as image:
        result["width"], result["height"] = image.size
        exif = image.getexif()
        by_name = {ExifTags.TAGS.get(key, str(key)): value for key, value in exif.items()}
        result.update({
            "capturedAt": str(by_name.get("DateTimeOriginal") or by_name.get("DateTime") or "").replace(":", "-", 2),
            "camera": " ".join(str(by_name.get(part, "")).strip() for part in ("Make", "Model")).strip(),
            "lens": str(by_name.get("LensModel") or by_name.get("LensMake") or ""),
            "shutterSpeed": rational_text(by_name.get("ExposureTime")),
            "aperture": rational_text(by_name.get("FNumber")),
            "iso": rational_text(by_name.get("PhotographicSensitivity") or by_name.get("ISOSpeedRatings")),
            "focalLength": rational_text(by_name.get("FocalLength")),
        })
        if result["shutterSpeed"] and "/" not in result["shutterSpeed"]:
            try:
                seconds = float(result["shutterSpeed"])
                result["shutterSpeed"] = f"1/{round(1 / seconds)}" if 0 < seconds < 1 else f"{seconds:g}s"
            except ValueError:
                pass
        gps_ifd = exif.get_ifd(ExifTags.IFD.GPSInfo) if hasattr(exif, "get_ifd") else {}
        gps = {ExifTags.GPSTAGS.get(key, str(key)): value for key, value in gps_ifd.items()}
        result["latitude"] = gps_decimal(gps.get("GPSLatitude"), str(gps.get("GPSLatitudeRef", "N")))
        result["longitude"] = gps_decimal(gps.get("GPSLongitude"), str(gps.get("GPSLongitudeRef", "E")))
    return result


def make_thumbnail(source: Path, destination: Path) -> tuple[int, int]:
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image)
        size = image.size
        image.thumbnail((720, 720), Image.Resampling.LANCZOS)
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        image.save(destination, "JPEG", quality=82, optimize=True)
        return size


def clean_payload(raw: dict[str, Any], exif: dict[str, Any] | None = None) -> dict[str, Any]:
    exif = exif or {}
    data = {key: raw.get(key) for key in PHOTO_FIELDS}
    visibility = str(data.get("visibility") or "private")
    data["visibility"] = visibility if visibility in VISIBILITIES else "private"
    for key in ("allowedUids", "allowedGroupIds", "tags", "albumIds"):
        data[key] = json_list(data.get(key))
    for key in ("latitude", "longitude"):
        try:
            data[key] = float(data[key]) if data.get(key) not in (None, "") else exif.get(key)
        except (TypeError, ValueError):
            data[key] = exif.get(key)
    for key in PHOTO_FIELDS:
        if key in {"allowedUids", "allowedGroupIds", "tags", "albumIds", "latitude", "longitude", "visibility"}:
            continue
        data[key] = str(data.get(key) or exif.get(key) or "").strip()[:10000 if key == "notes" else 1000]
    return data


def upload_payload(common: dict[str, Any], individual: Any, filename: str, exif: dict[str, Any]) -> dict[str, Any]:
    merged = dict(common)
    if isinstance(individual, dict):
        for key in PHOTO_FIELDS:
            if key in individual and individual[key] not in (None, "", []):
                merged[key] = individual[key]
    if not str(merged.get("title") or "").strip():
        merged["title"] = Path(filename).stem
    return clean_payload(merged, exif)


def row_photo(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    output = {
        "id": item["id"], "ownerUid": item["owner_uid"], "ownerEmail": item["owner_email"],
        "filename": item["filename"], "mime": item["mime"], "byteSize": item["byte_size"],
        "width": item["width"], "height": item["height"], "checksum": item["checksum"],
        "title": item["title"], "category": item["category"], "capturedAt": item["captured_at"],
        "location": item["location"], "station": item["station"], "latitude": item["latitude"],
        "longitude": item["longitude"], "trainNumber": item["train_number"], "origin": item["origin"],
        "destination": item["destination"], "trainType": item["train_type"], "serviceDate": item["service_date"],
        "changes": item["changes"], "transportRoute": item["transport_route"], "article": item["article"],
        "notes": item["notes"], "camera": item["camera"], "lens": item["lens"],
        "shutterSpeed": item["shutter_speed"], "aperture": item["aperture"], "iso": item["iso"],
        "focalLength": item["focal_length"], "tags": parse_json_list(item["tags_json"]),
        "visibility": item["visibility"], "allowedUids": parse_json_list(item["allowed_uids_json"]),
        "allowedGroupIds": parse_json_list(item["allowed_group_ids_json"]), "deletedAt": item["deleted_at"],
        "createdAt": item["created_at"], "updatedAt": item["updated_at"],
    }
    output["thumbnailUrl"] = f"/v1/photos/{item['id']}/media/thumbnail"
    output["originalUrl"] = f"/v1/photos/{item['id']}/media/original"
    return output


def group_ids(db: sqlite3.Connection, uid: str) -> set[str]:
    return {row[0] for row in db.execute("SELECT group_id FROM group_members WHERE uid=?", (uid,))}


def can_view(db: sqlite3.Connection, row: sqlite3.Row, uid: str) -> bool:
    if row["owner_uid"] == uid or row["visibility"] == "public":
        return True
    if row["visibility"] != "users":
        return False
    if uid in parse_json_list(row["allowed_uids_json"]):
        return True
    return bool(group_ids(db, uid).intersection(parse_json_list(row["allowed_group_ids_json"])))


def require_photo(db: sqlite3.Connection, photo_id: str) -> sqlite3.Row:
    row = db.execute("SELECT * FROM photos WHERE id=?", (photo_id,)).fetchone()
    if not row:
        raise HTTPException(404, "写真が見つかりません")
    return row


def purge_expired_trash() -> int:
    threshold = (datetime.now(JST) - timedelta(days=TRASH_DAYS)).isoformat(timespec="seconds")
    removed = 0
    with connect() as db:
        rows = db.execute("SELECT * FROM photos WHERE deleted_at IS NOT NULL AND deleted_at<?", (threshold,)).fetchall()
        for row in rows:
            Path(row["original_path"]).unlink(missing_ok=True)
            Path(row["thumbnail_path"]).unlink(missing_ok=True)
            db.execute("DELETE FROM album_photos WHERE photo_id=?", (row["id"],))
            db.execute("DELETE FROM shares WHERE target_type='photo' AND target_id=?", (row["id"],))
            db.execute("DELETE FROM photos WHERE id=?", (row["id"],))
            removed += 1
    return removed


@app.get("/health")
def health() -> dict[str, Any]:
    usage = shutil.disk_usage(ROOT)
    with connect() as db:
        photos = db.execute("SELECT COUNT(*) FROM photos WHERE deleted_at IS NULL").fetchone()[0]
        trash = db.execute("SELECT COUNT(*) FROM photos WHERE deleted_at IS NOT NULL").fetchone()[0]
    with OPERATION_DISPATCH.connect() as db:
        dispatches = db.execute("SELECT COUNT(*) FROM dispatches").fetchone()[0]
        active_dispatches = db.execute("SELECT COUNT(*) FROM dispatches WHERE status IN('active','monitoring')").fetchone()[0]
    return {"ok": True, "version": app.version, "photos": photos, "trash": trash, "trashDays": TRASH_DAYS,
            "operationDispatch": {"records": dispatches, "active": active_dispatches},
            "storage": {"totalBytes": usage.total, "usedBytes": usage.used, "freeBytes": usage.free}}


@app.get("/v1/me")
def current_user(user: dict[str, Any] = Depends(verify_user)) -> dict[str, Any]:
    return {key: user[key] for key in ("uid", "email", "role", "canUpload", "canManage")}


@app.post("/v1/photos")
async def upload_photos(
    files: Annotated[list[UploadFile], File()],
    metadata: Annotated[str, Form()] = "{}",
    file_metadata: Annotated[str, Form(alias="fileMetadata")] = "[]",
    user: dict[str, Any] = Depends(require_contributor),
) -> dict[str, Any]:
    try:
        raw = json.loads(metadata or "{}")
        individual_items = json.loads(file_metadata or "[]")
    except json.JSONDecodeError as error:
        raise HTTPException(400, "メタデータJSONが不正です") from error
    if not isinstance(raw, dict) or not isinstance(individual_items, list):
        raise HTTPException(400, "メタデータJSONの形式が不正です")
    if len(individual_items) > 100:
        raise HTTPException(400, "個別メタデータは100件までです")
    if not files or len(files) > 100:
        raise HTTPException(400, "1回に1〜100枚を選択してください")
    created: list[dict[str, Any]] = []
    for index, upload in enumerate(files):
        if not (upload.content_type or "").startswith("image/"):
            raise HTTPException(415, f"{upload.filename}: 画像ファイルではありません")
        photo_id = uuid.uuid4().hex
        extension = Path(upload.filename or "photo.jpg").suffix.lower()
        if extension not in {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic"}:
            extension = ".jpg"
        owner_dir = ORIGINALS / user["uid"]
        thumb_dir = THUMBNAILS / user["uid"]
        owner_dir.mkdir(parents=True, exist_ok=True)
        thumb_dir.mkdir(parents=True, exist_ok=True)
        original = owner_dir / f"{photo_id}{extension}"
        thumbnail = thumb_dir / f"{photo_id}.jpg"
        digest = hashlib.sha256()
        size = 0
        try:
            with original.open("wb") as target:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_UPLOAD_BYTES:
                        raise HTTPException(413, f"{upload.filename}: ファイルが大きすぎます")
                    digest.update(chunk)
                    target.write(chunk)
            exif = image_metadata(original)
            width, height = make_thumbnail(original, thumbnail)
        except HTTPException:
            original.unlink(missing_ok=True)
            thumbnail.unlink(missing_ok=True)
            raise
        except Exception as error:
            original.unlink(missing_ok=True)
            thumbnail.unlink(missing_ok=True)
            raise HTTPException(415, f"{upload.filename}: 画像を読み取れません") from error
        individual = individual_items[index] if index < len(individual_items) else {}
        data = upload_payload(raw, individual, upload.filename or original.name, exif)
        timestamp = now_iso()
        with connect() as db:
            db.execute("""INSERT INTO photos VALUES(
              ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                photo_id, user["uid"], user["email"], upload.filename or original.name, upload.content_type or "image/jpeg",
                str(original), str(thumbnail), size, width, height, digest.hexdigest(), data["title"], data["category"] or "other",
                data["capturedAt"], data["location"], data["station"], data["latitude"], data["longitude"],
                data["trainNumber"], data["origin"], data["destination"], data["trainType"], data["serviceDate"],
                data["changes"], data["transportRoute"], data["article"], data["notes"], data["camera"], data["lens"],
                data["shutterSpeed"], data["aperture"], data["iso"], data["focalLength"], json.dumps(data["tags"], ensure_ascii=False),
                data["visibility"], json.dumps(data["allowedUids"]), json.dumps(data["allowedGroupIds"]), None, timestamp, timestamp,
            ))
            for album_id in data["albumIds"]:
                album = db.execute("SELECT owner_uid FROM albums WHERE id=?", (album_id,)).fetchone()
                if album and album["owner_uid"] == user["uid"]:
                    db.execute("INSERT OR IGNORE INTO album_photos(album_id,photo_id) VALUES(?,?)", (album_id, photo_id))
            created.append(row_photo(require_photo(db, photo_id)))
    purge_expired_trash()
    return {"items": created, "count": len(created)}


@app.get("/v1/photos")
def list_photos(
    scope: str = "mine", q: str = "", date_from: str = Query("", alias="from"), date_to: str = Query("", alias="to"),
    camera: str = "", lens: str = "", tag: str = "", category: str = "", train_number: str = "",
    focal_min: float | None = None, focal_max: float | None = None, limit: int = Query(500, ge=1, le=2000),
    user: dict[str, str] = Depends(verify_user),
) -> dict[str, Any]:
    purge_expired_trash()
    with connect() as db:
        rows = db.execute("SELECT * FROM photos ORDER BY captured_at DESC, created_at DESC LIMIT 5000").fetchall()
        items: list[dict[str, Any]] = []
        needle = q.casefold().strip()
        for row in rows:
            if scope == "trash":
                if (not is_manager(user) and row["owner_uid"] != user["uid"]) or not row["deleted_at"]:
                    continue
            elif row["deleted_at"]:
                continue
            elif scope == "mine" and not is_manager(user) and row["owner_uid"] != user["uid"]:
                continue
            elif scope == "shared" and (row["owner_uid"] == user["uid"] or not can_view(db, row, user["uid"])):
                continue
            elif scope == "public" and row["visibility"] != "public":
                continue
            elif scope == "all" and not is_manager(user) and not can_view(db, row, user["uid"]):
                continue
            elif scope not in {"mine", "shared", "public", "all", "trash"}:
                raise HTTPException(400, "一覧区分が不正です")
            searchable = " ".join(str(row[key] or "") for key in (
                "title", "filename", "location", "station", "train_number", "origin", "destination", "train_type",
                "changes", "transport_route", "article", "notes", "camera", "lens", "tags_json",
            )).casefold()
            if needle and needle not in searchable: continue
            if date_from and row["captured_at"][:10] < date_from: continue
            if date_to and row["captured_at"][:10] > date_to: continue
            if camera and camera.casefold() not in row["camera"].casefold(): continue
            if lens and lens.casefold() not in row["lens"].casefold(): continue
            if tag and tag.casefold() not in [item.casefold() for item in parse_json_list(row["tags_json"])]: continue
            if category and row["category"] != category: continue
            if train_number and train_number.casefold() not in row["train_number"].casefold(): continue
            try: focal = float(re.sub(r"[^0-9.]", "", row["focal_length"]) or "nan")
            except ValueError: focal = float("nan")
            if focal_min is not None and not focal >= focal_min: continue
            if focal_max is not None and not focal <= focal_max: continue
            items.append(row_photo(row))
            if len(items) >= limit: break
    return {"items": items, "count": len(items)}


@app.get("/v1/photos/{photo_id}")
def get_photo(photo_id: str, user: dict[str, str] = Depends(verify_user)) -> dict[str, Any]:
    with connect() as db:
        row = require_photo(db, photo_id)
        if not is_manager(user) and not can_view(db, row, user["uid"]): raise HTTPException(403, "閲覧権限がありません")
        return row_photo(row)


@app.patch("/v1/photos/{photo_id}")
async def update_photo(photo_id: str, request: Request, user: dict[str, str] = Depends(verify_user)) -> dict[str, Any]:
    raw = await request.json()
    data = clean_payload(raw)
    with connect() as db:
        row = require_photo(db, photo_id)
        if not can_manage(row, user): raise HTTPException(403, "所有者または管理者だけが編集できます")
        db.execute("""UPDATE photos SET title=?,category=?,captured_at=?,location=?,station=?,latitude=?,longitude=?,
          train_number=?,origin=?,destination=?,train_type=?,service_date=?,changes=?,transport_route=?,article=?,notes=?,
          camera=?,lens=?,shutter_speed=?,aperture=?,iso=?,focal_length=?,tags_json=?,visibility=?,allowed_uids_json=?,
          allowed_group_ids_json=?,updated_at=? WHERE id=?""", (
            data["title"], data["category"], data["capturedAt"], data["location"], data["station"], data["latitude"], data["longitude"],
            data["trainNumber"], data["origin"], data["destination"], data["trainType"], data["serviceDate"], data["changes"],
            data["transportRoute"], data["article"], data["notes"], data["camera"], data["lens"], data["shutterSpeed"],
            data["aperture"], data["iso"], data["focalLength"], json.dumps(data["tags"], ensure_ascii=False), data["visibility"],
            json.dumps(data["allowedUids"]), json.dumps(data["allowedGroupIds"]), now_iso(), photo_id,
        ))
        if "albumIds" in raw:
            db.execute("DELETE FROM album_photos WHERE photo_id=?", (photo_id,))
            for album_id in data["albumIds"]:
                album = db.execute("SELECT owner_uid FROM albums WHERE id=?", (album_id,)).fetchone()
                if album and (album["owner_uid"] == user["uid"] or is_manager(user)):
                    db.execute("INSERT INTO album_photos(album_id,photo_id) VALUES(?,?)", (album_id, photo_id))
        return row_photo(require_photo(db, photo_id))


@app.delete("/v1/photos/{photo_id}")
def delete_photo(photo_id: str, user: dict[str, str] = Depends(verify_user)) -> dict[str, Any]:
    with connect() as db:
        row = require_photo(db, photo_id)
        if not can_manage(row, user): raise HTTPException(403, "所有者または管理者だけが削除できます")
        db.execute("UPDATE photos SET deleted_at=?,updated_at=? WHERE id=?", (now_iso(), now_iso(), photo_id))
    return {"ok": True, "purgeAfterDays": TRASH_DAYS}


@app.post("/v1/photos/{photo_id}/restore")
def restore_photo(photo_id: str, user: dict[str, str] = Depends(verify_user)) -> dict[str, Any]:
    with connect() as db:
        row = require_photo(db, photo_id)
        if not can_manage(row, user): raise HTTPException(403, "所有者または管理者だけが復元できます")
        db.execute("UPDATE photos SET deleted_at=NULL,updated_at=? WHERE id=?", (now_iso(), photo_id))
    return {"ok": True}


@app.get("/v1/photos/{photo_id}/media/{variant}")
def photo_media(photo_id: str, variant: str, user: dict[str, str] = Depends(verify_user)) -> FileResponse:
    with connect() as db:
        row = require_photo(db, photo_id)
        if not is_manager(user) and not can_view(db, row, user["uid"]): raise HTTPException(403, "閲覧権限がありません")
        path = Path(row["thumbnail_path"] if variant == "thumbnail" else row["original_path"])
        media_type = "image/jpeg" if variant == "thumbnail" else row["mime"]
    if variant not in {"thumbnail", "original"} or not path.is_file(): raise HTTPException(404, "画像が見つかりません")
    return FileResponse(path, media_type=media_type, filename=row["filename"] if variant == "original" else None)


def album_output(db: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    count = db.execute("SELECT COUNT(*) FROM album_photos WHERE album_id=?", (row["id"],)).fetchone()[0]
    return {"id": row["id"], "ownerUid": row["owner_uid"], "title": row["title"], "description": row["description"],
            "visibility": row["visibility"], "allowedUids": parse_json_list(row["allowed_uids_json"]),
            "allowedGroupIds": parse_json_list(row["allowed_group_ids_json"]), "coverPhotoId": row["cover_photo_id"],
            "photoCount": count, "createdAt": row["created_at"], "updatedAt": row["updated_at"]}


@app.get("/v1/albums")
def list_albums(user: dict[str, str] = Depends(verify_user)) -> dict[str, Any]:
    with connect() as db:
        rows = db.execute("SELECT * FROM albums WHERE deleted_at IS NULL ORDER BY updated_at DESC").fetchall()
        if not is_manager(user):
            rows = [row for row in rows if can_view(db, row, user["uid"])]
        return {"items": [album_output(db, row) for row in rows]}


@app.post("/v1/albums")
async def create_album(request: Request, user: dict[str, Any] = Depends(require_contributor)) -> dict[str, Any]:
    data = await request.json(); album_id = uuid.uuid4().hex; timestamp = now_iso()
    visibility = data.get("visibility") if data.get("visibility") in VISIBILITIES else "private"
    with connect() as db:
        db.execute("INSERT INTO albums VALUES(?,?,?,?,?,?,?,?,?,?,?)", (album_id, user["uid"], str(data.get("title") or "名称未設定")[:200],
          str(data.get("description") or "")[:5000], visibility, json.dumps(json_list(data.get("allowedUids"))),
          json.dumps(json_list(data.get("allowedGroupIds"))), data.get("coverPhotoId"), None, timestamp, timestamp))
        return album_output(db, db.execute("SELECT * FROM albums WHERE id=?", (album_id,)).fetchone())


@app.patch("/v1/albums/{album_id}")
async def update_album(album_id: str, request: Request, user: dict[str, Any] = Depends(verify_user)) -> dict[str, Any]:
    data = await request.json()
    visibility = data.get("visibility") if data.get("visibility") in VISIBILITIES else "private"
    allowed_uids = json_list(data.get("allowedUids"))
    allowed_group_ids = json_list(data.get("allowedGroupIds"))
    if visibility == "users" and not allowed_uids and not allowed_group_ids:
        raise HTTPException(400, "共有するユーザーまたはグループを選んでください")
    with connect() as db:
        album = db.execute("SELECT * FROM albums WHERE id=? AND deleted_at IS NULL", (album_id,)).fetchone()
        if not album:
            raise HTTPException(404, "アルバムが見つかりません")
        if not can_manage(album, user):
            raise HTTPException(403, "所有者または管理者だけが共有設定を変更できます")
        db.execute("UPDATE albums SET visibility=?,allowed_uids_json=?,allowed_group_ids_json=?,updated_at=? WHERE id=?",
          (visibility, json.dumps(allowed_uids), json.dumps(allowed_group_ids), now_iso(), album_id))
        return album_output(db, db.execute("SELECT * FROM albums WHERE id=?", (album_id,)).fetchone())


@app.get("/v1/albums/{album_id}/photos")
def album_photos(album_id: str, user: dict[str, str] = Depends(verify_user)) -> dict[str, Any]:
    with connect() as db:
        album = db.execute("SELECT * FROM albums WHERE id=? AND deleted_at IS NULL", (album_id,)).fetchone()
        if not album: raise HTTPException(404, "アルバムが見つかりません")
        if not is_manager(user) and not can_view(db, album, user["uid"]):
            raise HTTPException(403, "閲覧権限がありません")
        rows = db.execute("SELECT p.* FROM photos p JOIN album_photos ap ON ap.photo_id=p.id WHERE ap.album_id=? AND p.deleted_at IS NULL ORDER BY ap.position,p.captured_at", (album_id,)).fetchall()
        return {"album": album_output(db, album), "items": [row_photo(row) for row in rows]}


def password_digest(password: str, salt: bytes) -> str:
    return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1).hex()


@app.post("/v1/shares")
async def create_share(request: Request, user: dict[str, str] = Depends(verify_user)) -> dict[str, Any]:
    data = await request.json(); target_type = str(data.get("targetType") or "photo"); target_id = str(data.get("targetId") or "")
    if target_type not in {"photo", "album"}: raise HTTPException(400, "共有対象が不正です")
    with connect() as db:
        table = "photos" if target_type == "photo" else "albums"
        row = db.execute(f"SELECT owner_uid FROM {table} WHERE id=?", (target_id,)).fetchone()
        if not row or (row["owner_uid"] != user["uid"] and not is_manager(user)): raise HTTPException(403, "所有者または管理者だけが共有リンクを作れます")
        token = secrets.token_urlsafe(32); salt = secrets.token_bytes(16) if data.get("password") else None
        expires = normalized_expiry(data.get("expiresAt"))
        db.execute("INSERT INTO shares VALUES(?,?,?,?,?,?,?,?,?,NULL)", (uuid.uuid4().hex, user["uid"], target_type, target_id,
          hashlib.sha256(token.encode()).hexdigest(), salt.hex() if salt else None,
          password_digest(str(data["password"]), salt) if salt else None, expires, now_iso()))
    return {"token": token, "url": f"https://tayunet-traininfo.com/photo-share.html?token={token}",
            "passwordRequired": bool(salt), "expiresAt": expires}


def resolve_share(token: str, password: str | None) -> tuple[sqlite3.Connection, sqlite3.Row]:
    db = connect()
    row = db.execute("SELECT * FROM shares WHERE token_hash=? AND revoked_at IS NULL", (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
    if not row or (row["expires_at"] and row["expires_at"] < now_iso()):
        db.close(); raise HTTPException(404, "共有リンクが無効または期限切れです")
    if row["password_hash"]:
        salt = bytes.fromhex(row["password_salt"])
        if not password or not secrets.compare_digest(row["password_hash"], password_digest(password, salt)):
            db.close(); raise HTTPException(401, "共有パスワードが必要です")
    return db, row


@app.get("/public/{token}")
def public_share(token: str, x_share_password: Annotated[str | None, Header()] = None) -> dict[str, Any]:
    db, share = resolve_share(token, x_share_password)
    try:
        if share["target_type"] == "photo":
            photo = require_photo(db, share["target_id"])
            return {"type": "photo", "item": row_photo(photo), "passwordRequired": bool(share["password_hash"])}
        album = db.execute("SELECT * FROM albums WHERE id=?", (share["target_id"],)).fetchone()
        if not album: raise HTTPException(404, "アルバムが見つかりません")
        rows = db.execute("SELECT p.* FROM photos p JOIN album_photos ap ON ap.photo_id=p.id WHERE ap.album_id=? AND p.deleted_at IS NULL", (album["id"],)).fetchall()
        return {"type": "album", "album": album_output(db, album), "items": [row_photo(row) for row in rows],
                "passwordRequired": bool(share["password_hash"])}
    finally: db.close()


@app.get("/public/{token}/media/{photo_id}/{variant}")
def public_media(token: str, photo_id: str, variant: str, x_share_password: Annotated[str | None, Header()] = None) -> FileResponse:
    db, share = resolve_share(token, x_share_password)
    try:
        if share["target_type"] == "photo" and share["target_id"] != photo_id: raise HTTPException(403, "共有対象外です")
        if share["target_type"] == "album" and not db.execute("SELECT 1 FROM album_photos WHERE album_id=? AND photo_id=?", (share["target_id"], photo_id)).fetchone():
            raise HTTPException(403, "共有対象外です")
        photo = require_photo(db, photo_id)
        path = Path(photo["thumbnail_path"] if variant == "thumbnail" else photo["original_path"])
        media_type = "image/jpeg" if variant == "thumbnail" else photo["mime"]
        filename = photo["filename"] if variant == "original" else None
    finally: db.close()
    if variant not in {"thumbnail", "original"} or not path.is_file(): raise HTTPException(404, "画像が見つかりません")
    return FileResponse(path, media_type=media_type, filename=filename)


@app.get("/v1/directory")
def directory(q: str = "", user: dict[str, str] = Depends(verify_user)) -> dict[str, Any]:
    needle = q.strip()[:100]
    if needle and len(needle) < 2:
        return {"items": []}
    with connect() as db:
        rows = db.execute("""SELECT u.uid,u.email,u.display_name,u.last_seen_at,f.status,f.requested_by
          FROM users u LEFT JOIN friends f ON f.low_uid=MIN(u.uid,?) AND f.high_uid=MAX(u.uid,?)
          WHERE u.uid<>? AND lower(u.email) NOT IN (?,?)
            AND (?='' OR lower(u.email) LIKE lower(?) OR lower(u.display_name) LIKE lower(?))
          ORDER BY CASE WHEN f.status='pending' AND f.requested_by<>? THEN 0 WHEN f.status='accepted' THEN 2 ELSE 1 END,
            u.last_seen_at DESC LIMIT 30""", (
              user["uid"], user["uid"], user["uid"], *sorted(MANAGER_EMAILS), needle,
              f"%{needle}%", f"%{needle}%", user["uid"],
          )).fetchall()
        return {"items": [{"uid": row["uid"], "email": row["email"], "displayName": row["display_name"],
          "relationship": row["status"] or "none", "incoming": row["status"] == "pending" and row["requested_by"] != user["uid"]}
          for row in rows]}


@app.get("/v1/friends")
def friends(user: dict[str, str] = Depends(verify_user)) -> dict[str, Any]:
    with connect() as db:
        rows = db.execute("""SELECT f.*,u.uid,u.email,u.display_name FROM friends f JOIN users u
          ON u.uid=CASE WHEN f.low_uid=? THEN f.high_uid ELSE f.low_uid END
          WHERE f.low_uid=? OR f.high_uid=? ORDER BY f.updated_at DESC""", (user["uid"], user["uid"], user["uid"])).fetchall()
        return {"items": [{"uid": row["uid"], "email": row["email"], "displayName": row["display_name"], "status": row["status"],
          "incoming": row["status"] == "pending" and row["requested_by"] != user["uid"]} for row in rows]}


@app.post("/v1/friends/{target_uid}")
async def request_friend(target_uid: str, user: dict[str, str] = Depends(verify_user)) -> dict[str, Any]:
    if target_uid == user["uid"]: raise HTTPException(400, "自分自身は追加できません")
    token = str(user.get("_token") or "")
    if not token:
        raise HTTPException(401, "Firebaseログインをもう一度確認してください")
    profile = await active_directory_profile(target_uid, token)
    target_email = str(field(profile, "email") or "").strip().casefold()
    if not target_email or target_email in MANAGER_EMAILS:
        raise HTTPException(404, "共有できる利用者が見つかりません")
    target_name = str(field(profile, "displayName") or target_email.split("@")[0]).strip()[:200]
    low, high = sorted((user["uid"], target_uid)); timestamp = now_iso()
    with connect() as db:
        db.execute("""INSERT INTO users(uid,email,display_name,last_seen_at) VALUES(?,?,?,?)
          ON CONFLICT(uid) DO UPDATE SET email=excluded.email,display_name=excluded.display_name""",
          (target_uid, target_email, target_name, timestamp))
        existing = db.execute("SELECT * FROM friends WHERE low_uid=? AND high_uid=?", (low, high)).fetchone()
        status = "accepted" if existing and (existing["status"] == "accepted" or (existing["status"] == "pending" and existing["requested_by"] != user["uid"])) else "pending"
        db.execute("""INSERT INTO friends VALUES(?,?,?,?,?,?) ON CONFLICT(low_uid,high_uid)
          DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at""", (low, high, user["uid"], status, timestamp, timestamp))
    return {"ok": True, "status": status}


@app.delete("/v1/friends/{target_uid}")
def remove_friend(target_uid: str, user: dict[str, str] = Depends(verify_user)) -> dict[str, Any]:
    low, high = sorted((user["uid"], target_uid))
    with connect() as db:
        db.execute("DELETE FROM friends WHERE low_uid=? AND high_uid=?", (low, high))
    return {"ok": True}


@app.get("/v1/groups")
def groups(user: dict[str, str] = Depends(verify_user)) -> dict[str, Any]:
    with connect() as db:
        rows = db.execute("SELECT * FROM groups WHERE owner_uid=? OR id IN(SELECT group_id FROM group_members WHERE uid=?) ORDER BY updated_at DESC", (user["uid"], user["uid"])).fetchall()
        return {"items": [{**dict(row), "members": [member[0] for member in db.execute("SELECT uid FROM group_members WHERE group_id=?", (row["id"],))]} for row in rows]}


@app.post("/v1/groups")
async def create_group(request: Request, user: dict[str, str] = Depends(verify_user)) -> dict[str, Any]:
    data = await request.json(); group_id = uuid.uuid4().hex; timestamp = now_iso(); members = json_list(data.get("members"))
    with connect() as db:
        db.execute("INSERT INTO groups VALUES(?,?,?,?,?)", (group_id, user["uid"], str(data.get("name") or "グループ")[:100], timestamp, timestamp))
        for uid in set(members + [user["uid"]]): db.execute("INSERT OR IGNORE INTO group_members VALUES(?,?)", (group_id, uid))
    return {"id": group_id, "name": data.get("name"), "members": members}


@app.get("/v1/export/metadata.{format}")
def export_metadata(format: str, user: dict[str, str] = Depends(verify_user)) -> Response:
    with connect() as db:
        rows = db.execute("SELECT * FROM photos ORDER BY captured_at") if is_manager(user) else db.execute("SELECT * FROM photos WHERE owner_uid=? ORDER BY captured_at", (user["uid"],))
        items = [row_photo(row) for row in rows]
    if format == "json":
        return JSONResponse(items, headers={"Content-Disposition": "attachment; filename=photo-archive.json"})
    if format != "csv": raise HTTPException(404, "出力形式が不正です")
    buffer = io.StringIO(); fields = [key for key in items[0].keys() if not key.endswith("Url")] if items else ["id"]
    writer = csv.DictWriter(buffer, fieldnames=fields, extrasaction="ignore"); writer.writeheader()
    for item in items: writer.writerow({key: json.dumps(value, ensure_ascii=False) if isinstance(value, list) else value for key, value in item.items()})
    return Response(buffer.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=photo-archive.csv"})


@app.get("/v1/export/originals.zip")
def export_originals(user: dict[str, str] = Depends(verify_user)) -> FileResponse:
    fd, name = tempfile.mkstemp(prefix="photo-export-", suffix=".zip", dir=EXPORTS)
    os.close(fd)
    temporary = Path(name)
    with connect() as db, zipfile.ZipFile(temporary, "w", zipfile.ZIP_STORED) as archive:
        rows = db.execute("SELECT * FROM photos WHERE deleted_at IS NULL ORDER BY captured_at").fetchall() if is_manager(user) else db.execute("SELECT * FROM photos WHERE owner_uid=? AND deleted_at IS NULL ORDER BY captured_at", (user["uid"],)).fetchall()
        used: set[str] = set()
        for index, row in enumerate(rows, 1):
            safe = re.sub(r"[^A-Za-z0-9_. -]", "_", row["filename"]) or f"photo-{index}.jpg"
            name = safe if safe not in used else f"{index:05d}-{safe}"
            used.add(name); archive.write(row["original_path"], name)
    return FileResponse(temporary, media_type="application/zip", filename="photo-archive-originals.zip",
                        background=BackgroundTask(temporary.unlink, missing_ok=True))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, access_log=True)
