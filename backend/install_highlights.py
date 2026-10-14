"""Install the highlight writer beside an existing yomiai server (no schema migration)."""
from datetime import datetime, timezone
from pathlib import Path
import ast
import re
import shutil
import sys


def install(server):
    original = server.read_text()
    updated = original
    if 'from highlight_annotations import save_annotation' not in updated:
        updated = updated.replace('from device_backups import handle_backup', 'from device_backups import handle_backup\nfrom highlight_annotations import save_annotation')
    replacement = '''    def post_annotation(self, book_id):
        data = self.body_json()
        try:
            with connect() as conn:
                result = save_annotation(conn, book_id, data)
        except (ValueError, TypeError) as exc:
            return self.error(400, str(exc))
        return self.json(result)
'''
    updated, count = re.subn(r'    def post_annotation\(self, book_id\):\n.*?(?=\n    def get_current_session\(self\):)', replacement, updated, flags=re.S)
    if count != 1 or 'from highlight_annotations import save_annotation' not in updated:
        raise RuntimeError('Server annotation entry does not match; no files changed')
    ast.parse(updated)
    helper = Path(__file__).with_name('highlight_annotations.py')
    destination = server.with_name(helper.name)
    if helper.resolve() != destination.resolve():
        shutil.copy2(helper, destination)
    if updated != original:
        timestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        shutil.copy2(server, server.with_name(server.name + '.before-highlights-' + timestamp))
        server.write_text(updated)
    print('Highlight-only annotation writer installed; existing schema and notes retained.')


if __name__ == '__main__':
    install(Path(sys.argv[1]))
