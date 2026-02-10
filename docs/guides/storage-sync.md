# Storage Sync Guide (Oh My Prompt)

## Overview
Prompts are synced directly from the CLI to the PostgreSQL database via the server API.

## Setup

### 1) Configure server connection
```bash
omp config set sync.serverUrl https://your-server.example.com
omp config set sync.userToken your-user-token
omp config set sync.deviceId my-macbook
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
- Multiple devices can sync to the same account using unique `sync.deviceId` values
