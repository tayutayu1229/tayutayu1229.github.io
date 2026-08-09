import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
