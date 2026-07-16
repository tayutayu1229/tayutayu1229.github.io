import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from scraper import load_items, parse_listing, render_site, save_items


class ParserTest(unittest.TestCase):
    def test_press_item(self):
        html = '''<ul><li class="blank pdf show">
        <p class="date">2026年7月15日</p>
        <p class="icon"><span class="area">本社</span><span class="genre">経営・IR</span></p>
        <p class="text"><a href="/press/2026/test.pdf">テスト発表[PDF/202KB]<span class="screen-reader-text">PDFが別ウィンドウで開きます</span></a></p>
        </li></ul>'''
        items = parse_listing("press", html)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].title, "テスト発表")
        self.assertEqual(items[0].areas, ("本社",))
        self.assertEqual(items[0].genres, ("経営・IR",))
        self.assertEqual(items[0].url, "https://www.jreast.co.jp/press/2026/test.pdf")

    def test_information_item(self):
        html = '''<li><p class="date">2026年7月13日</p>
        <p class="icon"><span class="area">群馬</span></p>
        <p class="text"><a href="/info/2026/test.pdf">お知らせ</a></p></li>'''
        item = parse_listing("information", html)[0]
        self.assertEqual(item.source_label, "お知らせ")
        self.assertEqual(item.title, "お知らせ")

    def test_render_site(self):
        html = '''<li><p class="date">2026年7月15日</p>
        <p class="icon"><span class="area">本社</span></p>
        <p class="text"><a href="/press/2026/test.pdf">HTMLに&amp;安全に表示</a></p></li>'''
        items = parse_listing("press", html)
        with TemporaryDirectory() as directory:
            output = Path(directory)
            render_site(items, output)
            page = (output / "index.html").read_text(encoding="utf-8")
            self.assertIn("HTMLに&amp;安全に表示", page)
            self.assertTrue((output / "items.json").exists())
            self.assertTrue((output / ".nojekyll").exists())

    def test_error_status_and_cache(self):
        html = '''<li><p class="date">2026年7月15日</p><p class="text">
        <a href="/press/2026/test.pdf">前回のお知らせ</a></p></li>'''
        items = parse_listing("press", html)
        with TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / "data" / "items.json"
            save_items(cache, items)
            restored = load_items(cache)
            render_site(restored, root / "public", "アクセスを拒否されました")
            page = (root / "public" / "index.html").read_text(encoding="utf-8")
            self.assertIn("最新情報を取得できませんでした", page)
            self.assertIn("前回のお知らせ", page)
            self.assertIn("アクセスを拒否されました", page)


if __name__ == "__main__":
    unittest.main()
