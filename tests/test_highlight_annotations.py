import importlib.util
from pathlib import Path
import sqlite3
import unittest

spec = importlib.util.spec_from_file_location('highlight_annotations', Path(__file__).parents[1] / 'backend/highlight_annotations.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HighlightWrites(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('create table annotations (id text primary key, book_id text, chapter_index integer, paragraph_index integer, quote text, text text not null, author text, created_at text)')

    def tearDown(self):
        self.db.close()

    def test_highlight_survives_readback_and_retry(self):
        data = dict(kind='highlight', text='', quote='  留下\n 一笔  ', chapterIndex=2, paragraphIndex=0, author='nenei')
        first = module.save_annotation(self.db, 'book', data)
        self.assertEqual(first, module.save_annotation(self.db, 'book', data))
        self.assertEqual(self.db.execute('select quote, text from annotations').fetchall(), [('留下 一笔', '')])
        module.save_annotation(self.db, 'book', dict(data, text='之后补上的想法', kind=None))
        self.assertEqual(self.db.execute('select count(*) from annotations').fetchone()[0], 2)

    def test_empty_note_and_unanchored_highlight_rejected(self):
        for data in [dict(text=''), dict(kind='highlight', quote=''), dict(kind='highlight', quote='一句', paragraphIndex=None), dict(kind='highlight', quote='一句', paragraphIndex=-1)]:
            with self.assertRaises(ValueError):
                module.save_annotation(self.db, 'book', data)
        self.assertEqual(self.db.execute('select count(*) from annotations').fetchone()[0], 0)

    def test_legacy_note_and_distinct_anchors(self):
        module.save_annotation(self.db, 'book', dict(text='原有留言', quote='原句', author='ai'))
        for paragraph in [0, 1]:
            module.save_annotation(self.db, 'book', dict(kind='highlight', quote='同一句', paragraphIndex=paragraph, author='nenei'))
        self.assertEqual(self.db.execute('select count(*) from annotations').fetchone()[0], 3)


if __name__ == '__main__':
    unittest.main()
