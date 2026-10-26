import io
import json
import unittest
from email import policy
from email.parser import BytesParser
from unittest.mock import patch
from urllib.error import HTTPError

from scraper import Item, discord_request, pdf_previews, post_discord


class DiscordPreviewTest(unittest.TestCase):
    def setUp(self):
        self.item = Item('press', 'ニュースリリース', '2026年10月26日', 'テスト',
                         'https://www.jreast.co.jp/press/test.pdf', (), ())

    def test_multipart_retains_text_and_ordered_images(self):
        request = discord_request('https://example.invalid', {'content': 'テスト'},
                                  [('page-1.jpg', b'first'), ('page-2.jpg', b'second')])
        message = BytesParser(policy=policy.default).parsebytes(
            ('Content-Type: ' + request.get_header('Content-type') + '\r\n\r\n').encode() + request.data)
        parts = list(message.iter_parts())
        payload = json.loads(parts[0].get_payload(decode=True))
        self.assertEqual(payload['content'], 'テスト')
        self.assertEqual([a['id'] for a in payload['attachments']], [0, 1])
        self.assertEqual([p.get_payload(decode=True) for p in parts[1:]], [b'first', b'second'])

    def test_pdf_failure_still_sends_embed(self):
        with patch('scraper.pdf_previews', return_value=[]), patch('scraper.urlopen') as send:
            post_discord('https://example.invalid', [self.item])
        payload = json.loads(send.call_args.args[0].data)
        self.assertEqual(payload['embeds'][0]['url'], self.item.url)
        self.assertEqual(payload['embeds'][0]['title'], self.item.title)

    def test_attachment_rejected_falls_back_to_text(self):
        with patch('scraper.pdf_previews', return_value=[('page-1.jpg', b'image')]), patch('scraper.urlopen') as send:
            send.side_effect = [HTTPError('https://example.invalid', 413, 'too large', {}, io.BytesIO()),
                                unittest.mock.MagicMock()]
            post_discord('https://example.invalid', [self.item])
        payload = json.loads(send.call_args.args[0].data)
        self.assertNotIn('attachments', payload)
        self.assertEqual(payload['embeds'][0]['url'], self.item.url)

    def test_actual_pdf_renders_only_first_four_pages(self):
        import pymupdf
        with pymupdf.open() as document:
            for index in range(6):
                document.new_page().insert_text((72, 72), f'Page {index + 1}')
            data = document.tobytes()
        with patch('scraper.urlopen') as download:
            download.return_value.__enter__.return_value.read.return_value = data
            previews = pdf_previews(self.item)
        self.assertEqual(len(previews), 4)
        for name, image in previews:
            self.assertTrue(image.startswith(b'\xff\xd8'))

    def test_invalid_pdf_omits_images(self):
        with patch('scraper.urlopen') as download:
            download.return_value.__enter__.return_value.read.return_value = b'not pdf'
            self.assertEqual(pdf_previews(self.item), [])
