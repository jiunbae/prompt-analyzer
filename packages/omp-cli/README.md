# Oh My Prompt

> CLI tool for capturing, analyzing, and syncing AI coding prompts

[![npm version](https://img.shields.io/npm/v/oh-my-prompt.svg)](https://www.npmjs.com/package/oh-my-prompt)
[![Node.js](https://img.shields.io/node/v/oh-my-prompt.svg)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/oh-my-prompt.svg)](LICENSE)

**Oh My Prompt** captures your AI coding sessions (Claude Code, Codex, etc.) to a local SQLite database, syncs them to a server, and provides analytics insights into your prompting patterns.

## Features

- **Automatic capture**: Hook into Claude Code, Codex via shell scripts
- **Local storage**: SQLite database at `~/.omp/prompts.db`
- **Server sync**: Upload prompts to self-hosted server for analytics
- **Prompt analysis**: Get quality scores and improvement suggestions
- **Export/Import**: JSONL, CSV, or JSON formats
- **Privacy-first**: Redact secrets, responses optional

## Installation

### Global Install (Recommended)

```bash
npm install -g oh-my-prompt
```

### Using npx (No install)

```bash
npx oh-my-prompt setup
```

### From Source

```bash
git clone https://github.com/jiunbae/oh-my-prompt.git
cd oh-my-prompt
pnpm install
pnpm build:cli
cd packages/omp-cli
npm link
```

## Quick Start

### 1. Setup

Run the interactive setup wizard:

```bash
omp setup
```

This will:
- Create config at `~/.omp/config.json`
- Initialize SQLite database
- Detect installed CLIs (Claude, Codex)
- Optionally configure server sync

### 2. Install Hooks

Install hooks for your CLI(s):

```bash
omp install claude      # For Claude Code
omp install codex       # For Codex
omp install all         # For both
```

This adds prompt capture hooks to:
- Claude: `~/.claude/hooks/prompt_sent.sh`
- Codex: `~/.codex/notify.js` (or merges with existing)

### 3. Verify Setup

```bash
omp status
```

Expected output:
```
Server: https://prompt.jiun.dev (or not configured)
Token: configured / not configured
Storage: sqlite
SQLite: /Users/you/.omp/prompts.db
Hooks: claude=installed, codex=installed
Last capture: 2026-02-08T10:30:00.000Z
Queue: 0 files, 0 bytes
```

### 4. Use Your CLI

Just use Claude Code or Codex normally:
```bash
claude "Write a function to parse TOML"
codex "Add error handling to this file"
```

Prompts are automatically captured!

### 5. View Stats

```bash
omp stats
omp report
omp analyze <prompt-id>
```

## Commands

### Hook Management

```bash
omp install [claude|codex|all]    # Install prompt capture hooks
omp uninstall [claude|codex|all]  # Remove hooks
omp status                         # Show config and hook status
omp doctor                         # Validate setup and diagnose issues
```

### Data Management

```bash
omp sync                           # Sync local prompts to server
omp sync status                    # Show sync history
omp export [--format json|jsonl|csv] [--out file.json]
omp import codex-history [--path ~/.codex/history.jsonl]
```

### Analytics

```bash
omp stats [--since 2026-01-01] [--group-by day|week|project]
omp report [--format text|json] [--since 2026-01-01]
omp analyze <prompt-id>            # Analyze prompt quality
omp analyze --file prompt.txt      # Analyze file
omp analyze --stdin < prompt.txt   # Analyze from stdin
```

### Configuration

```bash
omp config get                     # Show full config
omp config get server.url          # Get specific value
omp config set server.url https://prompt.jiun.dev
omp config set server.token YOUR_TOKEN
omp config validate                # Check config validity
```

### Database

```bash
omp db migrate                     # Run schema migrations
```

### Low-level

```bash
omp ingest --stdin < payload.json  # Manually ingest payload
omp ingest --replay                # Replay failed queue
```

## Configuration

Config file: `~/.omp/config.json`

### Server Sync (Recommended)

```json
{
  "server": {
    "url": "https://prompt.jiun.dev",
    "token": "your-api-token"
  }
}
```

Or via CLI:
```bash
omp config set server.url https://prompt.jiun.dev
omp config set server.token YOUR_TOKEN
```

### Storage

```json
{
  "storage": {
    "type": "sqlite",
    "sqlite": {
      "path": "/Users/you/.omp/prompts.db"
    }
  }
}
```

### Capture Options

```json
{
  "capture": {
    "response": true,
    "redact": {
      "enabled": true,
      "mask": "[REDACTED]"
    }
  }
}
```

### Environment Variables

Override config with env vars:

```bash
export OMP_SERVER_URL="https://prompt.jiun.dev"
export OMP_SERVER_TOKEN="your-token"
export OMP_STORAGE_TYPE="sqlite"
export OMP_SQLITE_PATH="/custom/path/prompts.db"
export OMP_CAPTURE_RESPONSE="true"
```

## Hooks

### How Hooks Work

**Claude Code**:
- Adds `~/.claude/hooks/prompt_sent.sh`
- Triggered after every `claude` command
- Reads env vars: `$CLAUDE_PROMPT`, `$CLAUDE_RESPONSE`, `$CLAUDE_SESSION_ID`

**Codex**:
- Adds/updates `~/.codex/notify.js`
- Triggered on `agent-turn-complete` events
- Parses Codex event JSON

### Custom Hook Environment

Set `OMP_BIN` to use a custom omp binary:
```bash
export OMP_BIN="/custom/path/to/omp"
```

### Manual Hook Installation

If auto-install fails, manually add to `~/.claude/config.toml`:

```toml
[[hooks]]
name = "oh-my-prompt"
on = "prompt_sent"
script = "/Users/you/.omp/hooks/claude_prompt_sent.sh"
```

## Analytics Features

### Prompt Quality Score

```bash
omp analyze <prompt-id>
```

Output:
```
Score: 85 (Good)
Signals:
- Goal: present
- Context: present
- Constraints: missing
- Output format: present
- Examples: missing
Suggestions:
- Add specific constraints or requirements
- Include examples of expected output
```

### Stats Report

```bash
omp stats --group-by week
```

Output:
```
Overall:
{ total: 1234, avgLength: 450, avgTokens: 600 }
Grouped:
┌─────────┬───────┬───────┬───────────┐
│ week    │ count │ avgLen│ avgTokens │
├─────────┼───────┼───────┼───────────┤
│ 2026-06 │ 120   │ 420   │ 580       │
│ 2026-07 │ 145   │ 480   │ 620       │
└─────────┴───────┴───────┴───────────┘
```

### Report

```bash
omp report --since 2026-02-01
```

Generates:
- Total prompts, tokens, words
- Prompts per day/project
- Quality score distribution
- Top projects
- Improvement suggestions

## Sync to Server

### Setup Server Sync

1. Get an API token from your Oh My Prompt server
2. Configure sync:
   ```bash
   omp config set server.url https://prompt.jiun.dev
   omp config set server.token YOUR_TOKEN
   ```

3. Run initial sync:
   ```bash
   omp sync
   ```

### Automatic Sync

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
# Sync prompts every hour
(crontab -l 2>/dev/null | grep -Fv 'omp sync' ; echo "0 * * * * /usr/local/bin/omp sync # oh-my-prompt") | crontab -
```

Or use a background service (launchd on macOS, systemd on Linux).

### Manual Sync

```bash
omp sync                  # Sync all new prompts
omp sync --since 2026-01-01  # Sync from date
omp sync --dry-run        # Preview sync
omp sync status           # Show sync history
```

## Export / Import

### Export

```bash
omp export --format jsonl --out prompts.jsonl
omp export --format csv --out prompts.csv --since 2026-01-01
omp export --format json > prompts.json
```

### Import

```bash
omp import codex-history --path ~/.codex/history.jsonl
omp import codex-history --dry-run  # Preview
```

## Troubleshooting

### Hooks Not Working

1. Check hook status:
   ```bash
   omp status
   ```

2. Run doctor:
   ```bash
   omp doctor
   ```

3. Manually test hook:
   ```bash
   bash ~/.omp/hooks/claude_prompt_sent.sh
   ```

4. Check logs:
   ```bash
   tail -f ~/.omp/state.json
   ```

### Sync Failing

1. Check config:
   ```bash
   omp config validate
   ```

2. Test connectivity:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" https://prompt.jiun.dev/api/health
   ```

3. Force sync:
   ```bash
   omp sync --force
   ```

### Database Issues

```bash
omp db migrate            # Run migrations
omp config get storage.sqlite.path  # Check DB location
sqlite3 ~/.omp/prompts.db ".schema"  # Inspect schema
```

## Development

### Build from Source

```bash
git clone https://github.com/jiunbae/oh-my-prompt.git
cd oh-my-prompt
pnpm install
pnpm build:cli
cd packages/omp-cli
npm link
```

### Run Tests

```bash
cd packages/omp-cli
npm test
```

### Project Structure

```
packages/omp-cli/
├── bin/omp              # CLI entry point
├── lib/                 # Core modules (copied from src/omp/)
│   ├── cli.js           # Command router
│   ├── config.js        # Config management
│   ├── db.js            # SQLite operations
│   ├── hooks.js         # Hook installation
│   ├── ingest.js        # Payload processing
│   ├── sync.js          # Server sync
│   └── ...
└── package.json
```

## Contributing

Contributions welcome! Please:

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -m 'Add my feature'`
4. Push to branch: `git push origin feature/my-feature`
5. Open a Pull Request

## License

MIT © Jiun Bae

## Links

- **GitHub**: https://github.com/jiunbae/oh-my-prompt
- **npm**: https://www.npmjs.com/package/oh-my-prompt
- **Issues**: https://github.com/jiunbae/oh-my-prompt/issues
- **Docs**: See [docs/](https://github.com/jiunbae/oh-my-prompt/tree/main/docs)

## Acknowledgments

- Inspired by oh-my-zsh and prompt engineering best practices
- Built for Claude Code and Codex users
- Uses better-sqlite3 for fast local storage
