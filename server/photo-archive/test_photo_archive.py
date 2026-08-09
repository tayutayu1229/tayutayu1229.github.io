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


if __name__ == "__main__":
    unittest.main()
