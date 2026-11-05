import ast
import copy
from datetime import datetime, timezone
from pathlib import Path
import re
import sys
import tempfile
import types
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import discord_command_config as c


class Configuration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_defaults_keep_execution_roles_separate_from_notification_role(self):
        config = c.load(self.root)
        self.assertEqual(len(config['allowedRoleIds']), 3)
        self.assertEqual(c.notice_policy(self.root)['roleIds'], ['1489628881135730852'])
        self.assertFalse(config['notifications']['types']['github_pr']['enabled'])

    def test_revision_and_roundtrip_are_persistent_without_secrets(self):
        config = c.load(self.root)
        config['commands']['logs']['enabled'] = False
        config['secret'] = 'should-not-be-saved'
        saved = c.save(self.root, config)
        self.assertEqual(saved['revision'], 2)
        self.assertFalse(c.load(self.root)['commands']['logs']['enabled'])
        self.assertNotIn('should-not-be-saved', (self.root / 'discord-command-config.json').read_text())
        self.assertEqual((self.root / 'discord-command-config.json').stat().st_mode & 0o777, 0o600)
        with self.assertRaisesRegex(ValueError, '他の管理者'):
            c.save(self.root, config)

    def test_bad_ids_empty_access_and_duplicate_repos_are_rejected(self):
        changes = [lambda x:x.update(allowedRoleIds=['bad']), lambda x:x.update(allowedRoleIds=[],allowedUserIds=[]), lambda x:x.update(cooldownSeconds=0), lambda x:x['repositories'].append(copy.deepcopy(x['repositories'][0])), lambda x:x['repositories'][0].update(name=12), lambda x:x['notifications']['types'].update(ubuntu=None)]
        for change in changes:
            config = c.load(self.root)
            change(config)
            with self.subTest(config=config), self.assertRaises(ValueError):
                c.validate(config)

    def test_individual_notification_target_and_pause(self):
        config = c.load(self.root)
        config['notifications']['paused'] = True
        config['notifications']['types']['github_actions'].update(enabled=True, channelId='123456789012345678', mentionRoleIds=['1489628881135730851'])
        c.save(self.root, config)
        policy = c.notice_policy(self.root, 'github_actions')
        self.assertTrue(policy['paused'])
        self.assertEqual(policy['channelId'], '123456789012345678')
        self.assertEqual(policy['roleIds'], ['1489628881135730851'])

    def test_python_worker_rechecks_roles_channels_and_user_override(self):
        tree = ast.parse((Path(__file__).resolve().parents[1] / 'discord_command.py').read_text())
        ns = {'GUILD': '1489628881106243664'}
        exec(compile(ast.Module(body=[x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='permitted'],type_ignores=[]),'worker','exec'), ns)
        config = c.load(self.root)
        args = ('status', '222222222222222222', ['1489628881135730850'], '1499762805065388274', ns['GUILD'])
        self.assertTrue(ns['permitted'](config,*args))
        config['commands']['status']['userIds'] = ['333333333333333333']
        self.assertFalse(ns['permitted'](config,*args))
        self.assertTrue(ns['permitted'](config,'status','333333333333333333',[],args[-2],args[-1]))

    def test_worker_redacts_raw_tokens_keys_and_terminal_controls(self):
        root=Path(__file__).resolve().parents[1]
        source=ast.parse((root/'monitor_service.py').read_text());ns={'re':re}
        exec(compile(ast.Module(body=[x for x in source.body if isinstance(x,ast.FunctionDef) and x.name=='redact_sensitive'],type_ignores=[]),'monitor','exec'),ns)
        source=ast.parse((root/'discord_command.py').read_text());ns['monitor']=types.SimpleNamespace(redact_sensitive=ns['redact_sensitive'])
        exec(compile(ast.Module(body=[x for x in source.body if isinstance(x,ast.FunctionDef) and x.name=='sanitize'],type_ignores=[]),'worker','exec'),ns)
        token='ghp_'+'x'*30
        body=ns['sanitize']('password=do-not-show '+token+' \x1b[31mred\x1b[0m\n-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----')
        for secret in ['do-not-show',token,'private-material','\x1b']:
            self.assertNotIn(secret,body)


if __name__ == '__main__': unittest.main()
