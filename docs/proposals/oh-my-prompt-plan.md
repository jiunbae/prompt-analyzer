# Oh My Prompt - Product Plan (v1)

## 목적
Oh My Prompt는 에이전트에게 잘 명령하기 위해 내가 어떤 프롬프트를 어떻게 쓰는지 자동으로 기록하고, 인사이트를 통해 스스로 개선하도록 돕는 도구다.

## 확정된 결정
- 기본 저장소는 SQLite
- 기본 SQLite 경로는 `~/.config/oh-my-prompt/omp.db`
- MinIO/S3 동기화는 옵션
- MinIO/S3 포맷은 JSONL 청크 (v2)
- 응답 저장은 옵션, 기본값은 ON
- 1차 지원 CLI: Claude Code, Codex
- 2차 지원 CLI: Gemini, OpenCode
- 설치/제거는 단일 CLI(`omp`)에서 제공
- 지원 OS: macOS, Linux
- 로컬 큐는 용량 제한을 둔다 (기본 200MB)
- 동기화는 체크포인트 기반 증분 업로드를 지원
- 체크포인트는 디바이스별 `sync_state`로 관리
- `omp doctor`로 환경 검증/진단 제공
- 중복 이벤트 방지를 위해 `event_id` 기반 dedupe 적용
- 동기화(서버 업로드) 시 민감정보 마스킹 기본 ON (로컬 저장은 OFF)

## 범위
- 프롬프트 기록 저장
- 훅 설치/제거
- CLI 기반 상태/통계/리포트/분석
- 로컬 SQLite 기반 분석
- 선택적 MinIO/S3 동기화

## 비범위
- 실시간 협업 편집 기능
- 프롬프트 편집기 자체 제공
- 모델 호출을 직접 수행하는 런타임 제공

## 사용자 흐름
1. 사용자가 `omp install` 실행
2. 훅이 각 CLI에 설치됨
3. CLI 사용 시 프롬프트/응답이 로컬 SQLite에 기록됨
4. `omp stats`, `omp report` 등으로 인사이트 확인
5. 필요 시 MinIO/S3 동기화 활성화

## 저장소 설계
### 로컬 SQLite (기본)
- WAL 모드 사용
- 단일 writer 상황을 고려해 짧은 트랜잭션 유지
- 실패 시 로컬 임시 큐에 적재 후 재시도

### MinIO/S3 (옵션 동기화)
- 목적: 백업, 공유, 중앙 집계
- 로컬 SQLite가 원장(source of truth)
- 업로더는 배치 단위로 JSONL 청크 생성

## JSONL 청크 포맷 (v2)
- 경로: `{user_token}/{YYYY}/{MM}/{DD}/{HHmmss}-{device_id}.jsonl.gz`
- 각 라인은 하나의 prompt_record
- 필수 필드: `id`, `timestamp`, `source`, `role`, `prompt_text`, `session_id`
- 권장 필드: `response_text`, `prompt_type`, `project`, `cwd`, `model`, `cli_name`, `cli_version`, `hook_version`, `tags`, `token_estimate`

## 데이터 모델 (논리 스키마)
### prompt_record
- id (uuid)
- timestamp (datetime)
- source (string) 예: claude-code, codex
- session_id (string)
- role (user|assistant|system|tool)
- prompt_text (text)
- response_text (text, optional)
- prompt_length (int)
- response_length (int, optional)
- project (string, optional)
- cwd (string, optional)
- model (string, optional)
- cli_name (string)
- cli_version (string, optional)
- hook_version (string, optional)
- token_estimate (int, optional)
- word_count (int, optional)
- capture_response (bool)

### prompt_review
- prompt_id (uuid)
- score (int)
- signals (json)
- suggestions (json)
- created_at (datetime)

## 훅 설계
### 공통 요구
- 입력 이벤트 캡처
- 출력 이벤트 캡처 (옵션)
- 실패 시 로컬 큐 기록
- 클라이언트/모델 메타데이터 포함

### 지원 우선순위
- 1차: Claude Code, Codex
- 2차: Gemini, OpenCode

## 설치/제거
### 설치
- `omp install` 실행 시 CLI 자동 감지
- 각 CLI 훅 위치에 스크립트 주입
- `~/.config/oh-my-prompt/config.json` 생성
- 설치 검증용 이벤트 로그 출력

### 제거
- `omp uninstall` 실행 시 훅 제거
- 설정 파일 삭제는 옵션

## CLI 명령
- `omp install`
- `omp uninstall`
- `omp status`
- `omp stats --since 7d`
- `omp report --since 30d`
- `omp analyze <prompt-id|file>`
- `omp export --format jsonl|csv`
- `omp sync` (옵션 동기화 실행)

## 설정 파일 스키마 (초안)
- storage.type: sqlite|s3|minio
- storage.sqlite.path
- storage.s3.bucket
- storage.s3.region
- storage.s3.endpoint
- storage.s3.access_key
- storage.s3.secret_key
- capture.response: true|false
- hooks.enabled.claude_code: true|false
- hooks.enabled.codex: true|false
- hooks.enabled.gemini: true|false
- hooks.enabled.opencode: true|false

## 보안/개인정보
- 기본은 로컬 저장
- 동기화 시 자격 증명은 별도 보관
- 민감정보 필터링 옵션 검토
- 암호화 옵션은 차기 단계에서 검토

## 성능 고려사항
- SQLite는 WAL 모드 + 단일 writer 전략
- 훅은 비동기 큐로 저장소 부하 완화
- MinIO/S3는 청크 단위 업로드로 객체 수 최소화

## 테스트 전략
- 훅 설치/제거 테스트
- SQLite 쓰기/읽기 통합 테스트
- JSONL 청크 생성/업로드 테스트
- CLI 명령별 스냅샷 테스트

## 단계별 로드맵
### MVP 1
- SQLite 저장
- Claude Code, Codex 훅 설치
- CLI: status, stats, analyze

### MVP 2
- JSONL 청크 동기화 (MinIO/S3)
- report/analytics 고도화

### MVP 3
- Gemini, OpenCode 훅 지원
- 대시보드 연동
