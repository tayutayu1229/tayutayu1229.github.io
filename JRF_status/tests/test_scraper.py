import importlib.util
import sys
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('freight_scraper', ROOT / 'scraper.py')
scraper = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = scraper
spec.loader.exec_module(scraper)
FIXTURE = (Path(__file__).parent / 'fixtures/official-20261105.html').read_bytes()


class FreightParserTest(unittest.TestCase):
    def test_official_snapshot_keeps_every_train_and_incident(self):
        status = scraper.parse(FIXTURE)
        self.assertEqual(len(status.incidents), 8)
        self.assertEqual(len(status.sections), 4)
        self.assertEqual(sum(len(s.trains) for s in status.sections), 7)
        self.assertEqual(status.sections[0].trains[0], ('4日発1055列車(東京タ→福岡タ)', '終着', '+1時間59分'))
        self.assertEqual(status.sections[2].trains[-1][1], '石越')
        self.assertTrue(status.incidents[-1][1].endswith('鹿と列車の接触(遅れ)'))

    def test_spaces_do_not_define_columns(self):
        for spaces in [' ', '　', '　　　', '\u00a0']:
            with self.subTest(spaces=spaces):
                self.assertEqual(scraper.parse_train(f'4日発50～2050列車(札幌タ→仙台タ){spaces}盛　岡タ{spaces}+4時間17分予定'),
                                 ('4日発50~2050列車(札幌タ→仙台タ)', '盛岡タ', '+4時間17分予定'))

    def test_inline_markup_and_multiple_paragraphs_do_not_lose_trains(self):
        html = FIXTURE.decode().replace('1055列車', '<span>1055</span>列車').replace('4日発2067列車', '</p><p>4日発2067列車')
        status = scraper.parse(html.encode())
        self.assertEqual(len(status.sections[0].trains), 2)
        self.assertIn('1055列車', status.sections[0].trains[0][0])

    def test_incomplete_row_fails_instead_of_overwriting_valid_status(self):
        broken = FIXTURE.decode().replace('+1時間59分', '')
        with self.assertRaises(ValueError):
            scraper.parse(broken.encode())

    def test_missing_report_metadata_fails(self):
        with self.assertRaises(ValueError):
            scraper.parse(FIXTURE.replace('2026年11月5日'.encode(), b''))

    def test_linked_numbers_do_not_include_day_or_route_digits(self):
        status = scraper.parse(FIXTURE)
        payload = scraper.as_json(status, datetime(2026, 11, 5, tzinfo=scraper.JST))
        self.assertEqual(payload['trains'][-1]['trainNumbers'], ['2070', '3099', '99'])
        self.assertEqual(payload['trains'][-1]['departureDate'], '2026-11-03')
        self.assertEqual(len(payload['trains']), 7)

    def test_month_rollover_uses_previous_month(self):
        self.assertEqual(scraper.departure_date('31日発1055列車', datetime(2026, 11, 1)), '2026-10-31')

    def test_explicit_no_delays_is_a_valid_empty_report(self):
        html = '<div class="base_daiya"><p class="day">2026年11月5日</p><p class="time">0時現在</p><div class="base_daiya-content"><h2>発生時刻・概要</h2><p>現在、障害はありません。</p><h2>線　区</h2><p>遅れはありません。</p></div></div>'
        self.assertEqual(scraper.parse(html.encode()).sections, [])


if __name__ == '__main__':
    unittest.main()

class FetchHealthTest(unittest.TestCase):
    def test_cli_failure_preserves_data_and_reports_then_recovers(self):
        import subprocess
        import tempfile
        import json
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.html'
            source.write_bytes(FIXTURE)
            output = root / 'index.html'
            payload = root / 'status.json'
            health = root / 'health.json'
            command = [sys.executable, str(ROOT / 'scraper.py'), '--input', str(source), '--output', str(output), '--json-output', str(payload), '--health-output', str(health)]
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            original = payload.read_bytes()
            last_success = json.loads(health.read_text())['lastSuccessAt']
            source.write_text('<html>invalid response</html>')
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            failure = json.loads(health.read_text())
            self.assertFalse(failure['ok'])
            self.assertIn('ValueError', failure['error'])
            self.assertEqual(failure['lastSuccessAt'], last_success)
            self.assertEqual(payload.read_bytes(), original)
            source.write_bytes(FIXTURE)
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertTrue(json.loads(health.read_text())['ok'])

    def test_transient_missing_body_is_retried(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'index.html'
            with patch.object(sys, 'argv', ['scraper.py', '--output', str(output)]), patch.object(scraper, 'fetch', side_effect=[b'<html>temporary error</html>', FIXTURE]) as fetch, patch.object(scraper.time, 'sleep'):
                self.assertEqual(scraper.main(), 0)
                self.assertEqual(fetch.call_count, 2)
                self.assertIn('1055', output.read_text())

    def test_official_outside_service_hours_preserves_report_and_is_not_failure(self):
        import tempfile
        import subprocess
        import json
        from unittest.mock import patch
        notice = b'<div class="base_daiya"><div class="day">2026-11-05</div></div>' + '<div id="pbBlock91536">只今の時間帯はサービス時間外となります。</div>'.encode()
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            output=root/'index.html'; output.write_text('previous report')
            payload=root/'status.json'; payload.write_text('{"previous":true}')
            health=root/'health.json'; health.write_text('{"lastSuccessAt":"2026-11-05T01:30:05+09:00"}')
            with patch.object(sys,'argv',['scraper.py','--output',str(output),'--json-output',str(payload),'--health-output',str(health)]), patch.object(scraper,'fetch',return_value=notice) as fetch:
                self.assertEqual(scraper.main(),0)
                self.assertEqual(fetch.call_count,1,'時間外を何度も再取得しない')
            state=json.loads(health.read_text())
            self.assertTrue(state['ok'])
            self.assertFalse(state['available'])
            self.assertEqual(state['reason'],'outside_service_hours')
            self.assertEqual(state['lastSuccessAt'],'2026-11-05T01:30:05+09:00')
            self.assertEqual(output.read_text(),'previous report')
            self.assertEqual(payload.read_text(),'{"previous":true}')
