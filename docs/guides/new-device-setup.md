# Oh My Prompt - New Device Setup

Install the `omp` CLI on a new machine to capture and sync your AI coding prompts.

## Prerequisites

- **Node.js 20+** (via nvm or brew)
- **Claude Code** or **Codex** installed
- Your **user token** (from the web dashboard at Settings)

## Step 1: Install Node.js

```bash
# Install nvm if not present
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash

# Install and use Node.js 20
nvm install 20
nvm use 20
```

## Step 2: Clone Oh My Prompt

```bash
cd ~/workspace
git clone https://your-repo/oh-my-prompt.git
cd oh-my-prompt
```

Or copy from an existing machine:

```bash
rsync -avz --exclude='node_modules' --exclude='.next' --exclude='.git' \
  source-machine:~/workspace/oh-my-prompt/ ~/workspace/oh-my-prompt/
```

## Step 3: Install Dependencies

```bash
cd ~/workspace/oh-my-prompt
npm install --legacy-peer-deps better-sqlite3
```

## Step 4: Make `omp` Globally Available

```bash
mkdir -p ~/.local/bin
ln -sf ~/workspace/oh-my-prompt/bin/omp ~/.local/bin/omp

# Add to your shell profile (~/.zshrc or ~/.bashrc)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

## Step 5: Configure

Create the config file:

```bash
mkdir -p ~/.config/oh-my-prompt

cat > ~/.config/oh-my-prompt/config.json << 'EOF'
{
  "server": {
    "url": "YOUR_SERVER_URL",
    "token": "YOUR_USER_TOKEN",
    "deviceId": "YOUR_DEVICE_NAME"
  },
  "storage": {
    "sqlite": {
      "path": "~/.config/oh-my-prompt/prompts.db"
    }
  },
  "capture": {
    "response": true,
    "redact": {
      "enabled": false,
      "mask": "[REDACTED]"
    }
  },
  "hooks": {
    "enabled": {
      "claude_code": true,
      "codex": false,
      "gemini": false,
      "opencode": false
    }
  },
  "sync": {
    "enabled": true,
    "redact": {
      "enabled": true,
      "mask": "[REDACTED]"
    }
  }
}
EOF
```

Replace the following values:

| Placeholder | Where to find it |
|-------------|------------------|
| `YOUR_SERVER_URL` | Your Oh My Prompt server URL (e.g., `https://your-server.com`) |
| `YOUR_USER_TOKEN` | Web dashboard -> Settings -> API Token |
| `YOUR_DEVICE_NAME` | A name for this machine (e.g., `jiun-mbp`) |

## Step 6: Initialize Database

```bash
omp db migrate
```

Expected output: `Schema version: 3`

## Step 7: Install Hooks

```bash
# Install Claude Code hook
omp install claude

# (Optional) Install Codex hook
omp install codex
```

## Step 8: Verify

```bash
omp doctor
```

Expected output: `Doctor: OK`

## Usage

### Automatic Capture

Once hooks are installed, prompts are captured automatically when you use Claude Code or Codex.

### Sync to Server

```bash
# Upload local prompts to the server
omp sync
```

### View Stats

```bash
# Local prompt statistics
omp stats

# Detailed report
omp report
```

### Other Commands

```bash
omp status         # Current status
omp export         # Export data
omp config get     # View config
omp doctor         # Health check
```

## Troubleshooting

### `omp: command not found`

Make sure `~/.local/bin` is in your PATH:

```bash
echo $PATH | grep -q '.local/bin' || echo 'Add ~/.local/bin to PATH'
```

### `SyntaxError: Missing } in template expression`

You may be using an older version of `hooks.js`. Re-sync the code from the source.

### `no such table: schema_version`

Run `omp db migrate` to initialize the database.

### `Doctor: Claude hook enabled but not installed`

Run `omp install claude` to install the hook.

## Architecture

```
~/.config/oh-my-prompt/
├── config.json          # Configuration
├── prompts.db           # Local SQLite database
└── hooks/               # Hook scripts (auto-generated)

~/.claude/hooks/
└── prompt-logger.sh     # Claude Code hook (auto-installed)
```

## Quick Reference

| Command | Description |
|---------|-------------|
| `omp install claude` | Install Claude Code hook |
| `omp install codex` | Install Codex hook |
| `omp uninstall claude` | Remove Claude Code hook |
| `omp db migrate` | Run database migrations |
| `omp sync` | Upload local data to server |
| `omp stats` | Show prompt statistics |
| `omp report` | Generate detailed report |
| `omp doctor` | Check installation health |
| `omp config get` | Show current configuration |
| `omp config set server.token VALUE` | Update a config value |
