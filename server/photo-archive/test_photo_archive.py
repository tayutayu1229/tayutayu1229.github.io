import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from PIL import Image

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
            Image.new("RGB", (1200, 800), "white").save(source, exif=exif)
            metadata = archive.image_metadata(source)
            self.assertEqual(metadata["camera"], "Canon EOS 70D")
            self.assertEqual(metadata["capturedAt"], "2026-07-01 13:32:45")

    def test_database_schema_is_initialized(self):
        with archive.connect() as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({"photos", "albums", "shares", "friends", "groups"}.issubset(tables))

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
            with patch.object(archive, "active_firestore_profile", AsyncMock(return_value=profile)):
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


if __name__ == "__main__":
    unittest.main()
