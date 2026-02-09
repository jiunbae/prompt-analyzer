# Oh My Prompt - Hook Installation & Capture Spec (v1)

## 목적
- CLI 사용 중 생성되는 프롬프트/응답을 자동으로 수집한다.
- 훅 설치/제거를 `omp install`/`omp uninstall`로 통합한다.
- macOS/Linux 환경에서 안정적으로 동작한다.

## 원칙
- 로컬 SQLite에 즉시 기록 (기본)
- 네트워크 의존 최소화
- 훅 실패 시 로컬 큐로 안전하게 보관
- 응답 저장은 옵션(기본 ON)

## 디렉터리 구조
- 설정: `~/.config/oh-my-prompt/config.json`
- 상태/캐시: `~/.config/oh-my-prompt/state.json`
- 훅 스크립트: `~/.config/oh-my-prompt/hooks/<cli>/`
- 로컬 큐: `~/.config/oh-my-prompt/queue/`
- 로그(옵션): `~/.config/oh-my-prompt/logs/`

## 공통 훅 인터페이스
훅은 아래 JSON payload를 `omp ingest`로 전달한다.

### Payload (JSON)
```json
{
  "timestamp": "2026-02-05T12:34:56.000Z",
  "source": "claude-code",
  "session_id": "abc123",
  "project": "my-repo",
  "cwd": "/home/user/projects/my-repo",
  "role": "user",
  "text": "...prompt text...",
  "response_text": "...optional...",
  "model": "claude-3.7",
  "cli_name": "claude",
  "cli_version": "x.y.z",
  "hook_version": "1.0.0",
  "capture_response": true,
  "meta": {
    "prompt_type": "user_input"
  }
}
```

### Ingest 방식
- 훅은 `omp ingest --stdin`에 JSON line을 전달
- `omp ingest`는 SQLite에 저장하고, 실패 시 queue에 적재

```bash
printf '%s\n' "$PAYLOAD" | omp ingest --stdin
```

## 응답 저장 옵션
- `capture_response = true` 기본
- CLI에서 응답 훅 이벤트를 받을 수 없는 경우:
  - 응답은 비워 두고 입력만 저장
  - 이후 파일 기반 동기화로 보강 가능

## 훅 설치/제거 흐름
### 설치 (`omp install`)
1. CLI 감지 (executable + 설정 디렉터리 탐지)
2. 훅 파일 생성/삽입
3. 설정 파일 생성
4. 테스트 이벤트 전송

### 제거 (`omp uninstall`)
1. 훅 파일 원복/삭제
2. 관련 설정 제거 (옵션)

## CLI별 어댑터
### Claude Code (1차 지원)
- 훅 경로: `~/.claude/hooks/prompt-logger.sh` (기존 사용 경로)
- 동작:
  - 입력 시 `role=user` payload 생성
  - 출력 시 `role=assistant` payload 생성 (가능 시)
- pair 관리: 입력 이벤트의 hash를 상태 파일(`/tmp/omp_last_prompt_<session>.hash`)에 저장해 output과 연결
- fallback: `~/.claude/transcripts/*.jsonl` 기반 백필

### Codex (1차 지원)
- Codex는 `notify` 설정을 통해 외부 스크립트를 호출할 수 있음
- `CODEX_HOME` 기본 경로는 `~/.codex`, 설정 파일은 `config.toml`
- `notify`는 `agent-turn-complete` 이벤트에서 JSON 인자를 전달하며, 주요 필드:
  - `type`, `thread-id`, `turn-id`
  - `cwd`
  - `input-messages` (array of strings)
  - `last-assistant-message` (string)
- `omp install --cli codex`는 `notify = ["node", "<notify.js>"]`를 추가해 수집
- 기존 `notify`가 설정되어 있으면 `notify-wrapper.js`로 자동 병합
- 원래 `notify` 명령은 `notify-chain.json`에 보관
- fallback: `~/.codex/history.jsonl` (history persistence가 활성화된 경우)

### Gemini / OpenCode (2차)
- 우선은 CLI 훅/로그 위치를 확인한 뒤 어댑터 추가
- 각 CLI별 payload 변환기 작성

## 안정성/복구 전략
- 훅 실패 시 `queue/`에 JSONL 파일로 저장
- `omp ingest --replay`로 재처리 가능
- 로컬 큐는 용량 제한(기본 200MB) 설정

## 보안
- 로컬 저장 기본
- 동기화 키는 별도 암호화 스토리지 사용(추후)
- 민감 정보 필터링 옵션 추가 예정

## 오픈 이슈 (추가 확인 필요)
- Gemini CLI 훅/로그 위치
- OpenCode CLI 훅/로그 위치
