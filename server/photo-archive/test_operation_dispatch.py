import unittest
import uuid

from fastapi.testclient import TestClient

import photo_archive as archive


class OperationDispatchTest(unittest.TestCase):
    def setUp(self):
        self.user = {"uid": f"dispatcher-{uuid.uuid4().hex}", "email": "dispatcher@example.com", "displayName": "東京指令"}
        archive.app.dependency_overrides[archive.verify_user] = lambda: self.user

    def tearDown(self):
        archive.app.dependency_overrides.clear()

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
                "title": "完了後も確認が必要な電報", "category": "notice",
                "requiresAcknowledgement": True,
            }).json()
            client.post(f"/v1/operation-dispatch/{confirmation_required['id']}/status", json={"status": "resolved"})
            summary = client.get("/v1/operation-dispatch/summary").json()
            self.assertGreaterEqual(summary["unacknowledged"], 1)
            unacknowledged = client.get("/v1/operation-dispatch", params={"unacknowledged": "true"}).json()["items"]
            self.assertIn(confirmation_required["id"], {item["id"] for item in unacknowledged})


if __name__ == "__main__":
    unittest.main()
