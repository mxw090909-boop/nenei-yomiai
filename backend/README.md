# Device backup API

## Highlight-only annotations

Copy `highlight_annotations.py` and `install_highlights.py` alongside the existing
`server.py`, then run `python3 install_highlights.py /path/to/server.py` and restart
the API service. The installer backs up changed server code and installs the
annotation writer without a schema migration. A POST with `kind: "highlight"`,
an empty `text`, and a nonempty `quote` plus paragraph index stores a pure highlight.
Repeated identical highlight requests return the existing record. Notes retain
their existing format; a later note is added with the same quote and paragraph.

## Device backups

Deploy `device_backups.py` alongside the existing `server.py`.
Import `handle_backup` from `device_backups` and call it inside the existing
GET/PUT exception handlers, before the other routes:

```python
if handle_backup(self, parts, DATA_DIR, 'GET'):  # use 'PUT' in do_PUT
    return
```

Snapshots use a separate `data/device-backups.sqlite3` database. Existing book,
progress and annotation tables are untouched. Include this database in server
backups using SQLite's backup API.

The browser encrypts snapshots with AES-256-GCM and a fresh 12-byte IV.
The 32-byte recovery secret stays in localStorage and is shown in settings;
its SHA-256 hash addresses the remote snapshot. There is no listing endpoint.
Each device has its own slot; restoring creates a new slot, avoiding automatic
cross-device overwrites. The server accepts up to 48 MiB per encrypted request.

Local JSON exports are unencrypted and include settings, drafts, reading time,
appearance records and custom font data. Restoration first exports the current
snapshot and rolls back local writes on error. Books and submitted annotations
continue to live in the existing API and are not included in this device export.
