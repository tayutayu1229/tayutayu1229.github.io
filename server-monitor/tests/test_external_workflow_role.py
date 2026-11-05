import json
import os
from pathlib import Path
import textwrap
import unittest
from unittest.mock import patch, Mock

WORKFLOW = Path(__file__).resolve().parents[2] / '.github/workflows/ubuntu-external-monitor.yml'

class ExternalWorkflowRole(unittest.TestCase):
    def test_only_requested_role_on_incident_never_on_recovery(self):
        text = WORKFLOW.read_text().split('- name: Notify Discord on state change', 1)[1]
        block = text.split("python3 - <<'PY'\n", 1)[1].split('\n          PY', 1)[0]
        code = compile(textwrap.dedent(block), str(WORKFLOW), 'exec')
        for abnormal in (True, False):
            env = dict(DISCORD_BOT_TOKEN='dummy-test-token', DISCORD_CHANNEL_ID='1',
                       TITLE='test', DETAIL='@everyone <@&1489628881135730851>',
                       ABNORMAL='true' if abnormal else 'false')
            with patch.dict(os.environ, env, clear=True), patch('urllib.request.urlopen', return_value=Mock()) as send:
                exec(code, {})
            payload = json.loads(send.call_args.args[0].data)
            self.assertEqual(payload['content'], '<@&1489628881135730852>' if abnormal else '')
            self.assertEqual(payload['allowed_mentions'], dict(parse=[], roles=['1489628881135730852'] if abnormal else []))
            self.assertEqual(send.call_count, 1)

if __name__ == '__main__': unittest.main()
