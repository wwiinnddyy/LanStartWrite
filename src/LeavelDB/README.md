# LeavelDB

This module wraps the backend key-value storage using SQLite.

## Constraints

- Only backend process reads and writes DB.
- Renderer accesses state via backend HTTP API.
- DB path comes from env var `LANSTART_DB_PATH`.

## API

- `openLeavelDb(dbPath)`
- `getValue(db, key)`
- `getValueOrUndefined(db, key)`
- `putValue(db, key, value)`
- `deleteValue(db, key)`
- `listEntriesByPrefix(db, prefix, options)`
- `listKeysByPrefix(db, prefix, options)`
- `deleteByPrefix(db, prefix, options)`
