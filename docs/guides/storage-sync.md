# Storage Sync Guide (Oh My Prompt)

## Overview
Prompts are synced directly from the CLI to the PostgreSQL database via the server API.

## Setup

### 1) Configure server connection
```bash
omp config set server.url https://your-server.example.com
omp config set server.token your-user-token
omp config set server.deviceId my-macbook

# Redact only when uploading to server (recommended)
omp config set sync.redact.enabled true
omp config set sync.redact.mask "[REDACTED]"

# Optional: also redact locally before writing to SQLite
omp config set capture.redact.enabled true
```

### 2) Run sync
```bash
omp sync
```

### 3) Check sync status
```bash
omp sync status
```

### 4) Dry-run
```bash
omp sync --dry-run
```

## Notes
- Sync uploads local SQLite data to the server via `POST /api/sync/upload`
- Deduplication is handled server-side using event keys
- Multiple devices can sync to the same account using unique `server.deviceId` values
