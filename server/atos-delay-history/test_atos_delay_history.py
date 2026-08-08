import importlib.util
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("atos_delay_history.py")
SPEC = importlib.util.spec_from_file_location("atos_delay_history", MODULE_PATH)
history = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(history)


class AtosDelayHistoryTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        history.DB_PATH = Path(self.temporary_directory.name) / "history.sqlite3"
        history.STATE.update(last_cleanup=None, deleted_observations=0)
        history.LAST_STORAGE_CHECK_MONOTONIC = 0.0
        history.initialize_database()

    def tearDown(self):
        self.temporary_directory.cleanup()

    def insert_observation(self, date, station, delay, observed_at, destination="Atami"):
        railway = "odpt.Railway:JR-East.Tokaido"
        with history.connect() as database:
            database.execute(
                """
                INSERT INTO observations
                  (service_date, railway, train_number, station_id, phase, delay_seconds,
                   from_station, to_station, destination_station, observed_at)
                VALUES (?, ?, '100M', ?, 'departure', ?, ?, NULL, ?, ?)
                """,
                (date, railway, station, delay, station, destination, observed_at),
            )

    def test_snapshot_uses_odpt_source_timestamp_and_destination(self):
        now = datetime.now(history.JST).replace(microsecond=0)
        source_time = (now - timedelta(seconds=7)).isoformat()
        train = {
            "dc:date": source_time,
            "odpt:railway": "odpt.Railway:JR-East.Tokaido",
            "odpt:trainNumber": "100M",
            "odpt:fromStation": "odpt.Station:JR-East.Tokaido.Tokyo",
            "odpt:toStation": None,
            "odpt:delay": 0,
            "odpt:destinationStation": ["odpt.Station:JR-East.Tokaido.Atami"],
        }
        self.assertEqual(history.store_snapshot([train]), 1)
        with history.connect() as database:
            row = database.execute(
                "SELECT observed_at, destination_station FROM observations"
            ).fetchone()
        self.assertEqual(row["observed_at"], source_time)
        self.assertTrue(row["destination_station"].endswith(".Atami"))

    def test_train_history_returns_station_to_station_recovery(self):
        today = datetime.now(history.JST).date()
        for days_ago in (2, 1):
            date = (today - timedelta(days=days_ago)).isoformat()
            self.insert_observation(date, "Tokyo", 120, f"{date}T10:00:00+09:00")
            self.insert_observation(date, "Shinagawa", 60, f"{date}T10:10:00+09:00")
        result = history.train_history({
            "date": [today.isoformat()],
            "railway": ["odpt.Railway:JR-East.Tokaido"],
            "trainNumber": ["100M"],
        })
        prediction = result["predictions"]["Shinagawa"]
        self.assertEqual(prediction["expectedDelaySeconds"], 60)
        self.assertEqual(prediction["expectedChangeSeconds"], -60)
        self.assertEqual(prediction["sampleDays"], 2)

    def test_statistics_records_destination_change(self):
        today = datetime.now(history.JST).date()
        for days_ago, destination in ((2, "Atami"), (1, "Atami"), (0, "Odawara")):
            date = (today - timedelta(days=days_ago)).isoformat()
            self.insert_observation(date, "Tokyo", 0, f"{date}T10:00:00+09:00", destination)
        result = history.statistics({"days": ["3"]})
        self.assertEqual(len(result["destinationChanges"]), 1)
        change = result["destinationChanges"][0]
        self.assertEqual(change["usualDestinationStation"], "Atami")
        self.assertEqual(change["actualDestinationStation"], "Odawara")
        self.assertEqual(change["confidence"], 100.0)

    def test_storage_limit_deletes_oldest_observations(self):
        today = datetime.now(history.JST).date()
        old_date = (today - timedelta(days=2)).isoformat()
        new_date = today.isoformat()
        for index in range(600):
            date = old_date if index < 500 else new_date
            self.insert_observation(
                date,
                f"Station{index}",
                index,
                f"{date}T10:{index % 60:02d}:00+09:00",
            )

        initial = history.storage_status()
        original_values = (
            history.MAX_STORAGE_BYTES,
            history.STORAGE_TRIGGER_RATIO,
            history.STORAGE_TARGET_RATIO,
            history.STORAGE_DELETE_BATCH,
        )
        try:
            history.MAX_STORAGE_BYTES = initial["effectiveBytes"]
            history.STORAGE_TRIGGER_RATIO = 0.99
            history.STORAGE_TARGET_RATIO = 0.95
            history.STORAGE_DELETE_BATCH = 100
            deleted = history.cleanup_storage_limit(force=True)
        finally:
            (
                history.MAX_STORAGE_BYTES,
                history.STORAGE_TRIGGER_RATIO,
                history.STORAGE_TARGET_RATIO,
                history.STORAGE_DELETE_BATCH,
            ) = original_values

        self.assertGreater(deleted, 0)
        with history.connect() as database:
            oldest = database.execute("SELECT MIN(service_date) FROM observations").fetchone()[0]
            remaining = database.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
        self.assertLess(remaining, 600)
        self.assertGreaterEqual(oldest, old_date)
        self.assertEqual(history.STATE["storage_deleted_observations"], deleted)


if __name__ == "__main__":
    unittest.main()
