import base64
import asyncio
import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from PIL import Image
from PIL.TiffImagePlugin import IFDRational

import photo_archive as archive


class PhotoArchiveTest(unittest.TestCase):
    def test_payload_is_bounded_and_visibility_is_safe(self):
        payload = archive.clean_payload({
            "visibility": "administrator",
            "tags": ["貨物", "貨物", "夜景"],
            "allowedUids": ["user-a", "", "user-a"],
            "notes": "x" * 20000,
        })
        self.assertEqual(payload["visibility"], "private")
        self.assertEqual(payload["tags"], ["貨物", "夜景"])
        self.assertEqual(payload["allowedUids"], ["user-a"])
        self.assertEqual(len(payload["notes"]), 10000)

    def test_password_hash_is_salted_and_repeatable(self):
        salt = bytes.fromhex("00112233445566778899aabbccddeeff")
        first = archive.password_digest("secret", salt)
        self.assertEqual(first, archive.password_digest("secret", salt))
        self.assertNotEqual(first, archive.password_digest("other", salt))

    def test_thumbnail_is_generated_without_upscaling(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "original.jpg"
            target = Path(folder) / "thumbnail.jpg"
            Image.new("RGB", (1600, 900), "navy").save(source)
            self.assertEqual(archive.make_thumbnail(source, target), (1600, 900))
            with Image.open(target) as thumbnail:
                self.assertLessEqual(thumbnail.width, 720)
                self.assertLessEqual(thumbnail.height, 720)

    def test_exif_camera_and_capture_time_are_extracted(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "with-exif.jpg"
            exif = Image.Exif()
            exif[271] = "Canon"
            exif[272] = "EOS 70D"
            exif[36867] = "2026:07:01 13:32:45"
            exif[42036] = "EF 70-200mm F2.8L"
            exif[33434] = IFDRational(1, 400)
            exif[33437] = IFDRational(56, 10)
            exif[34855] = 320
            exif[37386] = IFDRational(85, 1)
            Image.new("RGB", (1200, 800), "white").save(source, exif=exif)
            metadata = archive.image_metadata(source)
            self.assertEqual(metadata["camera"], "Canon EOS 70D")
            self.assertEqual(metadata["capturedAt"], "2026-07-01 13:32:45")
            self.assertEqual(metadata["lens"], "EF 70-200mm F2.8L")
            self.assertEqual(metadata["shutterSpeed"], "1/400")
            self.assertEqual(metadata["aperture"], "5.6")
            self.assertEqual(metadata["iso"], "320")
            self.assertEqual(metadata["focalLength"], "85")

    def test_database_schema_is_initialized(self):
        with archive.connect() as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({"photos", "albums", "shares", "friends", "groups", "shooting_spots"}.issubset(tables))

    def test_shooting_spot_import_is_idempotent_and_shared(self):
        owner = {"uid": "spot-owner", "email": "spot-owner@example.com"}
        viewer = {"uid": "spot-viewer", "email": "spot-viewer@example.com"}
        item = {
            "id": "local-api-test-1", "kind": "nonTrain", "name": "<script>alert(1)</script>",
            "subject": "紅葉", "lat": 35.6812, "lng": 139.7671, "memo": "<img onerror=alert(1)>",
            "bloomStart": 11, "bloomEnd": 12, "features": ["利用者登録"],
        }
        archive.app.dependency_overrides[archive.verify_user] = lambda: owner
        try:
            with TestClient(archive.app) as client:
                first = client.post("/v1/spots/import", json={"items": [item]})
                second = client.post("/v1/spots/import", json={"items": [item]})
                self.assertEqual(first.status_code, 200, first.text)
                self.assertEqual(first.json()["created"], 1)
                self.assertEqual(second.status_code, 200, second.text)
                self.assertEqual(second.json()["created"], 0)
                archive.app.dependency_overrides[archive.verify_user] = lambda: viewer
                listed = client.get("/v1/spots")
                self.assertEqual(listed.status_code, 200, listed.text)
                matched = [spot for spot in listed.json()["items"] if spot["name"] == item["name"]]
                self.assertEqual(len(matched), 1)
                self.assertEqual(matched[0]["memo"], item["memo"])
        finally:
            archive.app.dependency_overrides.clear()

    def test_expiry_is_normalized_to_jst(self):
        self.assertTrue(archive.normalized_expiry("2026-08-10T12:30").endswith("+09:00"))
        self.assertIsNone(archive.normalized_expiry(""))

    def test_manager_accounts_are_read_only(self):
        manager = {"uid": "manager", "email": "ADMIN@tayunet-traininfo.com"}
        self.assertTrue(archive.is_manager(manager))
        with self.assertRaisesRegex(Exception, "登録できません"):
            archive.require_contributor(manager)
        self.assertFalse(archive.is_manager({"uid": "member", "email": "member@example.com"}))

    def test_individual_upload_metadata_overrides_common_values(self):
        payload = archive.upload_payload(
            {"location": "共通撮影地", "category": "train", "tags": ["共通"]},
            {"title": "第8765列車", "location": "新川崎駅", "tags": ["貨物"]},
            "DSC_0001.JPG",
            {"camera": "Example Camera"},
        )
        self.assertEqual(payload["title"], "第8765列車")
        self.assertEqual(payload["location"], "新川崎駅")
        self.assertEqual(payload["category"], "train")
        self.assertEqual(payload["tags"], ["貨物"])
        self.assertEqual(payload["camera"], "Example Camera")

    def test_directory_suggests_members_but_hides_manager_accounts(self):
        with archive.connect() as db:
            db.execute("INSERT OR REPLACE INTO users VALUES(?,?,?,?)", ("viewer", "viewer@example.com", "閲覧者", archive.now_iso()))
            db.execute("INSERT OR REPLACE INTO users VALUES(?,?,?,?)", ("member", "member@example.com", "撮影者", archive.now_iso()))
            db.execute("INSERT OR REPLACE INTO users VALUES(?,?,?,?)", ("manager", "admin@tayunet-traininfo.com", "管理者", archive.now_iso()))
        items = archive.directory("", {"uid": "viewer", "email": "viewer@example.com"})["items"]
        self.assertIn("member", {item["uid"] for item in items})
        self.assertNotIn("manager", {item["uid"] for item in items})

    def test_friend_request_imports_an_active_firebase_user(self):
        requester = {"uid": "firebase-requester", "email": "requester@example.com", "_token": "test-token"}
        target_uid = "firebase-target-not-yet-in-photo-archive"
        profile = {"fields": {
            "email": {"stringValue": "new.member@example.com"},
            "displayName": {"stringValue": "新規メンバー"},
            "approved": {"booleanValue": True},
            "status": {"stringValue": "active"},
            "disabled": {"booleanValue": False},
        }}
        archive.app.dependency_overrides[archive.verify_user] = lambda: requester
        try:
            with patch.object(archive, "active_directory_profile", AsyncMock(return_value=profile)):
                with TestClient(archive.app) as client:
                    response = client.post(f"/v1/friends/{target_uid}")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["status"], "pending")
            with archive.connect() as db:
                imported = db.execute("SELECT email,display_name FROM users WHERE uid=?", (target_uid,)).fetchone()
            self.assertEqual(imported["email"], "new.member@example.com")
            self.assertEqual(imported["display_name"], "新規メンバー")
        finally:
            archive.app.dependency_overrides.clear()

    def test_spot_concurrent_edit_is_rejected_and_history_is_kept(self):
        creator = {"uid": "spot-editor-a", "email": "a@example.com", "displayName": "編集者A"}
        editor = {"uid": "spot-editor-b", "email": "b@example.com", "displayName": "編集者B"}
        archive.app.dependency_overrides[archive.verify_user] = lambda: creator
        payload = {
            "clientId": "concurrency-test", "kind": "train", "name": "同時編集試験",
            "lat": 35.6812, "lng": 139.7671, "directions": ["up"],
        }
        try:
            with TestClient(archive.app) as client:
                created = client.post("/v1/spots", json=payload)
                self.assertEqual(created.status_code, 200, created.text)
                spot = created.json()
                archive.app.dependency_overrides[archive.verify_user] = lambda: editor
                first = client.patch(f"/v1/spots/{spot['id']}", json={**spot, "name": "先に保存", "expectedRevision": 1})
                self.assertEqual(first.status_code, 200, first.text)
                archive.app.dependency_overrides[archive.verify_user] = lambda: creator
                stale = client.patch(f"/v1/spots/{spot['id']}", json={**spot, "name": "後から上書き", "expectedRevision": 1})
                self.assertEqual(stale.status_code, 409, stale.text)
                current = client.get(f"/v1/spots/{spot['id']}")
                self.assertEqual(current.json()["name"], "先に保存")
                history = client.get(f"/v1/spots/{spot['id']}/history")
                self.assertEqual(history.status_code, 200, history.text)
                self.assertEqual(history.json()["items"][0]["actorName"], "編集者B")
                verified = client.post(f"/v1/spots/{spot['id']}/verify", json={"expectedRevision": 2})
                self.assertEqual(verified.status_code, 200, verified.text)
                self.assertTrue(verified.json()["verified"])
                self.assertEqual(verified.json()["verifiedBy"], "編集者A")
                self.assertEqual(verified.json()["revision"], 3)
                verified_history = client.get(f"/v1/spots/{spot['id']}/history").json()["items"][0]
                self.assertEqual(verified_history["action"], "verify")
                self.assertEqual(verified_history["actorName"], "編集者A")
        finally:
            archive.app.dependency_overrides.clear()

    def test_spot_trash_retention_and_manager_only_permanent_delete(self):
        member = {"uid": "trash-member", "email": "member@example.com", "displayName": "一般職員"}
        manager = {"uid": "trash-manager", "email": "admin@tayunet-traininfo.com", "displayName": "管理者"}
        archive.app.dependency_overrides[archive.verify_user] = lambda: member
        image = io.BytesIO()
        Image.new("RGB", (40, 30), "blue").save(image, "JPEG")
        encoded = base64.b64encode(image.getvalue()).decode("ascii")
        try:
            with TestClient(archive.app) as client:
                created = client.post("/v1/spots", json={
                    "clientId": "trash-retention-test", "kind": "nonTrain", "name": "ゴミ箱試験",
                    "lat": 35.6, "lng": 139.7, "photo": f"data:image/jpeg;base64,{encoded}",
                }).json()
                with archive.connect() as db:
                    media = db.execute("SELECT original_path FROM shooting_spot_media WHERE spot_id=?", (created["id"],)).fetchone()
                    media_path = Path(media["original_path"])
                    db.execute("INSERT INTO shooting_spot_favorites(uid,spot_id,created_at) VALUES(?,?,?)",
                               ("favorite-user", created["id"], archive.now_iso()))
                deleted = client.request("DELETE", f"/v1/spots/{created['id']}", json={"expectedRevision": created["revision"]})
                self.assertEqual(deleted.status_code, 200, deleted.text)
                denied = client.delete(f"/v1/spots/{created['id']}/permanent")
                self.assertEqual(denied.status_code, 403, denied.text)
                deleted_at = datetime.fromisoformat(deleted.json()["deletedAt"])
                archive.purge_expired_spots(deleted_at + timedelta(days=29, hours=23))
                with archive.connect() as db:
                    self.assertIsNotNone(db.execute("SELECT id FROM shooting_spots WHERE id=?", (created["id"],)).fetchone())
                archive.app.dependency_overrides[archive.verify_user] = lambda: manager
                removed = client.delete(f"/v1/spots/{created['id']}/permanent")
                self.assertEqual(removed.status_code, 200, removed.text)
                with archive.connect() as db:
                    self.assertIsNone(db.execute("SELECT id FROM shooting_spots WHERE id=?", (created["id"],)).fetchone())
                    self.assertEqual(db.execute("SELECT COUNT(*) FROM shooting_spot_history WHERE spot_id=?", (created["id"],)).fetchone()[0], 0)
                    self.assertEqual(db.execute("SELECT COUNT(*) FROM shooting_spot_favorites WHERE spot_id=?", (created["id"],)).fetchone()[0], 0)
                self.assertFalse(media_path.exists())
        finally:
            archive.app.dependency_overrides.clear()

    def test_legacy_spot_photo_is_separated_and_invalid_images_are_rejected(self):
        user = {"uid": "spot-photo-user", "email": "photo@example.com", "displayName": "写真担当"}
        archive.app.dependency_overrides[archive.verify_user] = lambda: user
        image = io.BytesIO()
        Image.new("RGB", (320, 180), "green").save(image, "JPEG")
        encoded = base64.b64encode(image.getvalue()).decode("ascii")
        try:
            with TestClient(archive.app) as client:
                created = client.post("/v1/spots", json={
                    "clientId": "legacy-photo-test", "kind": "nonTrain", "name": "旧画面互換",
                    "lat": 35.6, "lng": 139.7, "photo": f"data:image/jpeg;base64,{encoded}",
                })
                self.assertEqual(created.status_code, 200, created.text)
                self.assertTrue(created.json()["hasPhoto"])
                self.assertNotIn("photo", created.json())
                listed = client.get("/v1/spots")
                legacy = next(item for item in listed.json()["items"] if item["id"] == created.json()["id"])
                self.assertEqual(legacy["name"], "旧画面互換")
                self.assertNotIn("photo", legacy)
                thumbnail = client.get(legacy["thumbnailUrl"])
                self.assertEqual(thumbnail.status_code, 200, thumbnail.text)
                fake = client.put(
                    f"/v1/spots/{legacy['id']}/photo",
                    files={"file": ("fake.jpg", b"not an image", "image/jpeg")},
                    data={"expectedRevision": legacy["revision"]},
                )
                self.assertEqual(fake.status_code, 415, fake.text)
                small = io.BytesIO()
                Image.new("RGB", (20, 20), "red").save(small, "PNG")
                with patch.object(archive, "MAX_SPOT_IMAGE_PIXELS", 100):
                    huge = client.put(
                        f"/v1/spots/{legacy['id']}/photo",
                        files={"file": ("large.png", small.getvalue(), "image/png")},
                        data={"expectedRevision": legacy["revision"]},
                    )
                self.assertEqual(huge.status_code, 413, huge.text)
        finally:
            archive.app.dependency_overrides.clear()

    def test_invalid_firebase_token_is_rejected(self):
        archive.app.dependency_overrides.clear()
        with TestClient(archive.app) as client:
            response = client.get("/v1/spots", headers={"Authorization": "Bearer invalid-token"})
        self.assertEqual(response.status_code, 401, response.text)

    def test_firestore_unavailable_fails_closed_without_profile_cache(self):
        client = AsyncMock()
        client.get.side_effect = OSError("offline")
        manager = AsyncMock()
        manager.__aenter__.return_value = client
        manager.__aexit__.return_value = False
        with patch.object(archive.httpx, "AsyncClient", return_value=manager):
            with self.assertRaises(archive.HTTPException) as raised:
                asyncio.run(archive.active_firestore_profile("test-uid", "test-token"))
        self.assertEqual(raised.exception.status_code, 503)

    def test_upload_edit_and_password_share_flow(self):
        contributor = {"uid": "integration-user", "email": "integration@example.com"}
        archive.app.dependency_overrides[archive.require_contributor] = lambda: contributor
        archive.app.dependency_overrides[archive.verify_user] = lambda: contributor
        image = io.BytesIO()
        Image.new("RGB", (1280, 720), "royalblue").save(image, "JPEG")
        image.seek(0)
        try:
            with TestClient(archive.app) as client:
                uploaded = client.post(
                    "/v1/photos",
                    files={"files": ("operation-test.jpg", image.getvalue(), "image/jpeg")},
                    data={
                        "metadata": json.dumps({"category": "train", "location": "試験撮影地"}),
                        "fileMetadata": json.dumps([{"title": "運用確認写真", "trainNumber": "9001"}]),
                    },
                )
                self.assertEqual(uploaded.status_code, 200, uploaded.text)
                photo = uploaded.json()["items"][0]
                self.assertEqual(photo["title"], "運用確認写真")
                self.assertEqual(photo["trainNumber"], "9001")
                self.assertEqual(client.get(f"/v1/photos/{photo['id']}/media/thumbnail").status_code, 200)

                edited = client.patch(f"/v1/photos/{photo['id']}", json={**photo, "title": "編集済み運用確認写真", "tags": ["試験", "共有"]})
                self.assertEqual(edited.status_code, 200, edited.text)
                self.assertEqual(edited.json()["title"], "編集済み運用確認写真")

                shared = client.post("/v1/shares", json={
                    "targetType": "photo", "targetId": photo["id"], "password": "test-pass", "expiresAt": "2099-01-01T00:00",
                })
                self.assertEqual(shared.status_code, 200, shared.text)
                token = shared.json()["token"]
                self.assertEqual(client.get(f"/public/{token}").status_code, 401)
                public = client.get(f"/public/{token}", headers={"X-Share-Password": "test-pass"})
                self.assertEqual(public.status_code, 200, public.text)
                self.assertEqual(public.json()["item"]["title"], "編集済み運用確認写真")
        finally:
            archive.app.dependency_overrides.clear()

    def test_album_can_be_shared_with_a_specific_member(self):
        owner = {"uid": "album-owner", "email": "owner@example.com"}
        archive.app.dependency_overrides[archive.require_contributor] = lambda: owner
        archive.app.dependency_overrides[archive.verify_user] = lambda: owner
        try:
            with TestClient(archive.app) as client:
                created = client.post("/v1/albums", json={"title": "共有アルバム"})
                self.assertEqual(created.status_code, 200, created.text)
                album_id = created.json()["id"]
                shared = client.patch(f"/v1/albums/{album_id}", json={
                    "visibility": "users", "allowedUids": ["album-viewer"], "allowedGroupIds": [],
                })
                self.assertEqual(shared.status_code, 200, shared.text)
                self.assertEqual(shared.json()["visibility"], "users")
                self.assertEqual(shared.json()["allowedUids"], ["album-viewer"])

                archive.app.dependency_overrides[archive.verify_user] = lambda: {"uid": "album-viewer", "email": "viewer@example.com"}
                visible_albums = client.get("/v1/albums")
                self.assertEqual(visible_albums.status_code, 200, visible_albums.text)
                self.assertIn(album_id, {item["id"] for item in visible_albums.json()["items"]})
                viewed = client.get(f"/v1/albums/{album_id}/photos")
                self.assertEqual(viewed.status_code, 200, viewed.text)
                self.assertEqual(viewed.json()["album"]["title"], "共有アルバム")
        finally:
            archive.app.dependency_overrides.clear()


if __name__ == "__main__":
    unittest.main()
