"""Encrypted device snapshots. The client retains the decryption key."""
import base64
import json
import re
import sqlite3
from datetime import datetime, timezone

MAX_BODY = 48 * 1024 * 1024


def handle_backup(handler, parts, data_dir, method):
    if not parts or parts[0] != 'device-backups':
        return False
    if len(parts) != 2 or not re.fullmatch(r'[a-f0-9]{64}', parts[1]):
        handler.error(400, 'invalid backup id')
        return True
    backup_id = parts[1]
    payload = None
    if method == 'PUT':
        try:
            length = int(handler.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BODY:
                handler.error(413, 'backup too large')
                return True
            payload = json.loads(handler.rfile.read(length))
            if not isinstance(payload, dict) or payload.get('version') != 1:
                raise ValueError('version')
            iv = base64.b64decode(payload['iv'], validate=True)
            encrypted = base64.b64decode(payload['data'], validate=True)
            if len(iv) != 12 or len(encrypted) < 16:
                raise ValueError('ciphertext')
            payload = json.dumps({'version': 1, 'iv': payload['iv'], 'data': payload['data']})
        except (ValueError, KeyError, TypeError):
            handler.error(400, 'invalid encrypted backup')
            return True
    with sqlite3.connect(data_dir / 'device-backups.sqlite3', timeout=15) as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS device_backups (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)')
        if method == 'PUT':
            stamp = datetime.now(timezone.utc).isoformat()
            conn.execute('INSERT INTO device_backups VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at', (backup_id, payload, stamp))
            conn.commit()
            handler.json({'ok': True, 'updatedAt': stamp})
        else:
            row = conn.execute('SELECT payload FROM device_backups WHERE id=?', (backup_id,)).fetchone()
            if row is None:
                handler.error(404, 'backup not found')
            else:
                handler.json(json.loads(row[0]))
    return True
