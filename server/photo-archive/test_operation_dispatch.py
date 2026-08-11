import unittest
import uuid
import sqlite3
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

import photo_archive as archive
from operation_dispatch import JST, OperationDispatchStore, operating_day


class OperationDispatchTest(unittest.TestCase):
    def setUp(self):
        self.user = {"uid": f"dispatcher-{uuid.uuid4().hex}", "email": "dispatcher@example.com", "displayName": "東京指令"}
        archive.app.dependency_overrides[archive.verify_user] = lambda: self.user

    def tearDown(self):
        archive.app.dependency_overrides.clear()

    def test_operating_day_changes_at_3am(self):
        self.assertEqual(operating_day(datetime(2026, 8, 12, 2, 59, 59, tzinfo=JST)), "2026-08-11")
        self.assertEqual(operating_day(datetime(2026, 8, 12, 3, 0, 0, tzinfo=JST)), "2026-08-12")

    def test_operating_date_filter_uses_received_time_and_3am_boundary(self):
        with TestClient(archive.app) as client:
            before_boundary = client.post("/v1/operation-dispatch", json={"title": "3時前", "category": "notice"}).json()
            after_boundary = client.post("/v1/operation-dispatch", json={"title": "3時以後", "category": "notice"}).json()
            with archive.OPERATION_DISPATCH.connect() as db:
                db.execute("UPDATE dispatches SET received_at=? WHERE id=?", ("2026-08-12T02:59:59+09:00", before_boundary["id"]))
                db.execute("UPDATE dispatches SET received_at=? WHERE id=?", ("2026-08-12T03:00:00+09:00", after_boundary["id"]))
            items = client.get("/v1/operation-dispatch", params={"operating_date": "2026-08-11"}).json()["items"]
            ids = {item["id"] for item in items}
            self.assertIn(before_boundary["id"], ids)
            self.assertNotIn(after_boundary["id"], ids)

    def test_daily_numbering_uses_category_bands_and_resets(self):
        with TemporaryDirectory() as directory:
            store = OperationDispatchStore(Path(directory) / "dispatch.sqlite3")
            with store.connect() as db:
                self.assertEqual(store.next_number(db, "2026-08-11", "operation"), "TKG-501号")
                self.assertEqual(store.next_number(db, "2026-08-11", "rolling_stock"), "TKG-502号")
                self.assertEqual(store.next_number(db, "2026-08-11", "passenger"), "TKG-701号")
                self.assertEqual(store.next_number(db, "2026-08-11", "weather"), "TKG-702号")
                self.assertEqual(store.next_number(db, "2026-08-11", "notice"), "TKG-901号")
                self.assertEqual(store.next_number(db, "2026-08-12", "operation"), "TKG-501号")
                self.assertEqual(store.next_number(db, "2026-08-12", "passenger"), "TKG-701号")
                self.assertEqual(store.next_number(db, "2026-08-12", "other"), "TKG-901号")

    def test_legacy_unique_numbers_are_migrated_without_losing_relations(self):
        with TemporaryDirectory() as directory:
            database = Path(directory) / "legacy.sqlite3"
            with sqlite3.connect(database) as db:
                db.executescript("""
                CREATE TABLE dispatch_sequences(service_date TEXT PRIMARY KEY, last_number INTEGER NOT NULL);
                CREATE TABLE dispatches(
                  id TEXT PRIMARY KEY, dispatch_number TEXT NOT NULL UNIQUE,
                  service_date TEXT NOT NULL, event_at TEXT, received_at TEXT NOT NULL,
                  category TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL,
                  title TEXT NOT NULL, line_name TEXT, location TEXT, reason TEXT, body TEXT,
                  recipients TEXT, sender_uid TEXT NOT NULL, sender_email TEXT NOT NULL,
                  sender_name TEXT, requires_ack INTEGER NOT NULL DEFAULT 0,
                  handover INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
                  effective_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                  resolved_at TEXT, dispatched_at TEXT
                );
                CREATE TABLE dispatch_updates(
                  id TEXT PRIMARY KEY, dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
                  kind TEXT NOT NULL, body TEXT NOT NULL, author_uid TEXT NOT NULL,
                  author_email TEXT NOT NULL, author_name TEXT, created_at TEXT NOT NULL
                );
                """)
                required = ("", "resolved", "件名", "", "", "", "", "", "uid", "user@example.com", "", 0, 0, 0, "", "2026-08-10T10:00:00+09:00", "2026-08-10T10:00:00+09:00", None, "2026-08-10T09:59:00+09:00")
                sql = "INSERT INTO dispatches VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
                db.execute(sql, ("notice", "TKG-901号", "2026-08-10", None, "2026-08-10T10:00:00+09:00", "notice", *required))
                db.execute(sql, ("passenger", "TKG-902号", "2026-08-10", None, "2026-08-10T10:01:00+09:00", "passenger", *required))
                db.execute(sql, ("operation", "TKG-903号", "2026-08-11", None, "2026-08-11T10:00:00+09:00", "operation", *required))
                db.execute("INSERT INTO dispatch_updates VALUES('update-1','notice','memo','保存確認','uid','user@example.com','担当','2026-08-10T10:02:00+09:00')")

            store = OperationDispatchStore(database)
            with store.connect() as db:
                numbers = dict(db.execute("SELECT id,dispatch_number FROM dispatches"))
                self.assertEqual(numbers, {"notice": "TKG-901号", "passenger": "TKG-701号", "operation": "TKG-501号"})
                self.assertEqual(db.execute("SELECT COUNT(*) FROM dispatch_updates").fetchone()[0], 1)
                self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_create_search_acknowledge_followup_and_resolve(self):
        with TestClient(archive.app) as client:
            created = client.post("/v1/operation-dispatch", json={
                "serviceDate": "2026-08-08", "eventAt": "2026-08-08T09:52",
                "dispatchedAt": "2026-08-08T10:01", "category": "delay", "title": "京浜東北線 急病人救護",
                "lineName": "京浜東北線", "location": "大宮駅", "reason": "急病のお客様救護",
                "body": "大宮駅で救護を実施。後続列車に遅れ。", "recipients": "各駅・各指令",
                "requiresAcknowledgement": True, "handover": True,
                "trains": [{"trainNumber": "905A", "action": "遅延", "sectionFrom": "大宮", "delayMinutes": 5}],
            })
            self.assertEqual(created.status_code, 200, created.text)
            item = created.json()
            self.assertRegex(item["dispatchNumber"], r"^TKG-\d{3,}号$")
            self.assertEqual(item["dispatchedAt"], "2026-08-08T10:01")
            self.assertIsNotNone(item["receivedAt"])
            self.assertEqual(item["trains"][0]["delayMinutes"], 5)

            listed = client.get("/v1/operation-dispatch", params={"q": "905A", "status": "open"})
            self.assertEqual(listed.status_code, 200, listed.text)
            self.assertIn(item["id"], {dispatch["id"] for dispatch in listed.json()["items"]})

            acknowledged = client.post(f"/v1/operation-dispatch/{item['id']}/acknowledge")
            self.assertTrue(acknowledged.json()["acknowledged"])
            self.assertEqual(acknowledged.json()["acknowledgementCount"], 1)
            unacknowledged = client.get("/v1/operation-dispatch", params={"unacknowledged": "true"})
            self.assertNotIn(item["id"], {dispatch["id"] for dispatch in unacknowledged.json()["items"]})

            followed = client.post(f"/v1/operation-dispatch/{item['id']}/updates", json={
                "kind": "followup", "body": "救護完了。運転再開、遅れは6分。",
            })
            self.assertEqual(followed.status_code, 200, followed.text)
            self.assertEqual(followed.json()["updates"][-1]["kind"], "followup")

            resolved = client.post(f"/v1/operation-dispatch/{item['id']}/status", json={
                "status": "resolved", "handover": False, "note": "平常運転へ復帰",
            })
            self.assertEqual(resolved.json()["status"], "resolved")
            self.assertIsNotNone(resolved.json()["resolvedAt"])

    def test_summary_favorite_and_csv_export(self):
        with TestClient(archive.app) as client:
            created = client.post("/v1/operation-dispatch", json={
                "title": "忘れ物防止放送", "category": "passenger",
                "body": "繁忙期のため忘れ物防止放送を強化してください。",
            }).json()
            favorite = client.post(f"/v1/operation-dispatch/{created['id']}/favorite", json={"enabled": True})
            self.assertTrue(favorite.json()["favorite"])
            favorites = client.get("/v1/operation-dispatch", params={"favorite": "true"}).json()["items"]
            self.assertIn(created["id"], {item["id"] for item in favorites})
            self.assertEqual(client.get("/v1/operation-dispatch/summary").status_code, 200)
            exported = client.get("/v1/operation-dispatch/export.csv")
            self.assertEqual(exported.status_code, 200)
            self.assertIn("忘れ物防止放送", exported.content.decode("utf-8-sig"))
            self.assertIn("打電日時", exported.content.decode("utf-8-sig"))
            self.assertIn("受付日時", exported.content.decode("utf-8-sig"))

            confirmation_required = client.post("/v1/operation-dispatch", json={
                "title": "完了すると確認不要になる電報", "category": "notice",
                "requiresAcknowledgement": True,
            }).json()
            resolved = client.post(f"/v1/operation-dispatch/{confirmation_required['id']}/status", json={"status": "resolved"}).json()
            self.assertFalse(resolved["confirmationRequired"])
            summary = client.get("/v1/operation-dispatch/summary").json()
            unacknowledged = client.get("/v1/operation-dispatch", params={"unacknowledged": "true"}).json()["items"]
            self.assertNotIn(confirmation_required["id"], {item["id"] for item in unacknowledged})
            acknowledgement_count = resolved["acknowledgementCount"]
            after_ack = client.post(f"/v1/operation-dispatch/{confirmation_required['id']}/acknowledge").json()
            self.assertEqual(after_ack["acknowledgementCount"], acknowledgement_count)


if __name__ == "__main__":
    unittest.main()
