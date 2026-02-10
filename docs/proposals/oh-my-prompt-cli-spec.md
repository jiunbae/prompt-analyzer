# Oh My Prompt - CLI Spec (v1)

## 바이너리 이름
- `omp`

## 공통 규칙
- 모든 명령은 `--config`로 설정 파일 경로를 덮어쓸 수 있음
- `--json` 옵션으로 JSON 출력 지원
- 표준 exit codes
  - 0: 성공
  - 1: 일반 오류
  - 2: 설정/인자 오류
  - 3: 저장소 접근 실패

## 설정 파일
- 기본 경로: `~/.config/oh-my-prompt/config.json`

### 환경변수 우선순위 (override)
- `OMP_CONFIG_PATH`
- `OMP_STORAGE_TYPE` (sqlite|minio|s3)
- `OMP_SQLITE_PATH`
- `OMP_CAPTURE_RESPONSE` (true|false)
- `OMP_S3_BUCKET`, `OMP_S3_REGION`, `OMP_S3_ENDPOINT`, `OMP_S3_ACCESS_KEY`, `OMP_S3_SECRET_KEY`

## 명령 목록

### 1) `omp install`
CLI 훅 설치 및 초기 설정 생성.

옵션:
- `--cli <claude|codex|gemini|opencode|all>`
- `--storage <sqlite|minio|s3>`
- `--sqlite-path <path>`
- `--capture-response <true|false>`
- `--non-interactive`

예시:
```bash
omp install --cli claude --storage sqlite
```

Codex 주의사항:
- Codex는 `notify` 설정을 사용한다.
- 기존 `notify`가 있으면 자동으로 덮어쓰지 않는다.

### 2) `omp uninstall`
훅 제거 및 설정 삭제 옵션 제공.

옵션:
- `--cli <claude|codex|gemini|opencode|all>`
- `--remove-config` (default false)

### 3) `omp status`
설치/저장소/수집 상태 확인.

출력 예시:
```
Storage: sqlite (~/ .config/oh-my-prompt/omp.db)
Hooks: claude=installed, codex=installed, gemini=not installed
Last capture: 2026-02-05 21:32:11
Queue: 0 pending
Last replay: 2026-02-05 21:10:00 (processed 12, failed 0)
```

옵션:
- `--json`

### 4) `omp stats`
기본 통계 조회.

옵션:
- `--since <7d|30d|YYYY-MM-DD>`
- `--until <YYYY-MM-DD>`
- `--group-by <day|week|month>`
- `--json`

### 5) `omp report`
프롬프트 개선 리포트.

옵션:
- `--since <30d|YYYY-MM-DD>`
- `--format <text|json>`
- `--json`

출력 포함 항목:
- 평균 점수
- Top gaps (goal/context/constraints/output 등)
- 길이 분포

### 6) `omp analyze`
단일 프롬프트 리뷰.

입력:
- `omp analyze <prompt-id>`
- `omp analyze --file <path>`
- `omp analyze --stdin`

옵션:
- `--json`

### 7) `omp export`
데이터 내보내기.

옵션:
- `--format <jsonl|csv>`
- `--since <YYYY-MM-DD>`
- `--until <YYYY-MM-DD>`
- `--out <path>`

### 8) `omp sync`
MinIO/S3 동기화 실행.

옵션:
- `--dry-run`
- `--since <YYYY-MM-DD>`
- `--chunk-size <n>` (records per JSONL)
- `--force` (락 강제 해제)
- `--lock-ttl <ms>`

### 8-1) `omp sync status`
동기화 상태/최근 기록 조회.

```bash
omp sync status
omp sync status --json
```
옵션:
- `--limit <n>`

### 9) `omp ingest` (internal)
훅에서 호출하는 내부 커맨드.

옵션:
- `--stdin`
- `--json <payload>`
- `--source <cli>`
- `--capture-response <true|false>`

### 10) `omp config`
설정 조회/수정.

```bash
omp config get
omp config get storage.type
omp config set server.url https://your-server.example.com
omp config set server.token your-token
omp config set server.deviceId my-mac
omp config set storage.s3.bucket oh-my-prompt
omp config validate
# Redact only when uploading to server (recommended)
omp config set sync.redact.enabled true
omp config set sync.redact.mask "[REDACTED]"

# Optional: also redact locally before writing to SQLite
omp config set capture.redact.enabled true
omp config set capture.redact.mask "[REDACTED]"
```

### 11) `omp import`
백필/이관용 importer.

```bash
omp import codex-history --path ~/.codex/history.jsonl
```

### 12) `omp db`
로컬 SQLite 마이그레이션.

```bash
omp db migrate
```

### 13) `omp doctor`
환경 진단.

```bash
omp doctor
omp doctor --json
```

## CLI 출력 표준
- 기본은 사람이 읽기 쉬운 텍스트
- `--json` 사용 시 machine-readable JSON

## 설치 배포 전략
- npm 패키지로 배포 (권장)
- `npm i -g oh-my-prompt` 또는 `npx oh-my-prompt`

## 비고
- Windows는 v1 범위 밖 (macOS/Linux 우선)
- CLI 훅과 실제 CLI 이벤트 구조는 각 어댑터에서 흡수
