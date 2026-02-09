<div align="center">

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo-light.svg" />
  <img alt="Oh My Prompt" src="docs/assets/logo-dark.svg" width="540" />
</picture>

<br />

### Your AI coding sessions, captured and analyzed.

A self-hosted prompt journal + CLI that captures every interaction<br />with Claude Code, Codex, and more — then turns them into actionable insights.

<br />

[![npm version](https://img.shields.io/npm/v/oh-my-prompt?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/oh-my-prompt)
[![License](https://img.shields.io/github/license/jiunbae/oh-my-prompt?style=for-the-badge&color=blue)](LICENSE)
[![Node](https://img.shields.io/node/v/oh-my-prompt?style=for-the-badge&logo=node.js&logoColor=white&color=339933)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)

<br />

**[Getting Started](#-getting-started)** · **[CLI](#-cli)** · **[Dashboard](#-dashboard)** · **[Self-Hosting](#-self-hosting)** · **[Contributing](#-contributing)**

<br />

<!-- Replace with actual screenshot -->
<!-- <img src="docs/assets/dashboard-preview.png" alt="Dashboard Preview" width="800" /> -->

</div>

<br />

## Why?

You write **hundreds of prompts a day** to AI coding agents. But do you actually know which ones work?

**Oh My Prompt** gives you the answer. It captures every prompt, scores its quality, and shows you patterns you'd never notice on your own.

<br />

<table>
<tr>
<td width="33%" align="center">

**🎯 Capture**

Shell hooks silently intercept<br/>every prompt you send

</td>
<td width="33%" align="center">

**📊 Analyze**

Quality scores, token usage,<br/>session patterns, trends

</td>
<td width="33%" align="center">

**🔄 Sync**

Local SQLite → server API<br/>Works offline, syncs when ready

</td>
</tr>
</table>

<br />

## How It Works

```
  You                    CLI                     Server
  ───                    ───                     ──────

  claude "fix the bug"
       │
       └──── hook ────▶  omp ingest ──▶ SQLite (local)
                              │
                              └── omp sync ──▶ POST /api/sync/upload
                                                      │
                                               ┌──────┴──────┐
                                               │  PostgreSQL  │
                                               │  MinIO       │
                                               │  Analytics   │
                                               └──────────────┘
                                                      │
                                               your-server.com
                                          (dashboard, charts, insights)
```

<br />

## 🚀 Getting Started

```bash
# Install
npm install -g oh-my-prompt

# Setup (interactive wizard)
omp setup

# Verify
omp doctor
```

That's it. Now use Claude Code or Codex normally — prompts are captured automatically.

```bash
claude "Refactor this function to use async/await"
#        ↑ captured silently in the background
```

<br />

## 📟 CLI

<details>
<summary><b>omp setup</b> — Interactive configuration wizard</summary>

```bash
$ omp setup

  ✨ Oh My Prompt Setup

  ? Server URL: https://your-server.com
  ? API Token: ********-****-****-****-************
  ? Device name: my-laptop
  ? Install Claude Code hook? Yes
  ? Install Codex hook? Yes

  ✓ Config saved to ~/.omp/config.json
  ✓ Database initialized
  ✓ Claude Code hook installed
  ✓ Codex hook installed
  ✓ Server connection verified

  You're all set! Prompts will be captured automatically.
```
</details>

<details>
<summary><b>omp analyze</b> — Score prompt quality</summary>

```bash
$ omp analyze abc123

  Score: 85/100 (Good)

  Signals:
    ✓ Goal         Clear objective stated
    ✓ Context      Background information provided
    ✗ Constraints  No specific constraints
    ✓ Output       Expected format described
    ✗ Examples     No examples included

  Suggestions:
    → Add specific constraints or requirements
    → Include examples of expected output
```
</details>

<details>
<summary><b>omp stats</b> — View statistics</summary>

```bash
$ omp stats --group-by week

  Overall: 1,234 prompts · 450 avg length · 600 avg tokens

  ┌──────────┬───────┬─────────┬───────────┐
  │ Week     │ Count │ Avg Len │ Avg Tokens│
  ├──────────┼───────┼─────────┼───────────┤
  │ 2026-W05 │   120 │     420 │       580 │
  │ 2026-W06 │   145 │     480 │       620 │
  │ 2026-W07 │   198 │     510 │       650 │
  └──────────┴───────┴─────────┴───────────┘
```
</details>

<details>
<summary><b>All commands</b></summary>

| Command | Description |
|:--------|:------------|
| `omp setup` | Interactive configuration wizard |
| `omp install [claude\|codex\|all]` | Install capture hooks |
| `omp uninstall [claude\|codex\|all]` | Remove capture hooks |
| `omp status` | Show config and hook status |
| `omp doctor` | Validate setup, diagnose issues |
| `omp sync` | Sync local prompts to server |
| `omp sync status` | Show sync history |
| `omp stats [--group-by day\|week]` | View statistics |
| `omp report [--since DATE]` | Detailed text report |
| `omp analyze <id\|--file\|--stdin>` | Prompt quality analysis |
| `omp export [--format json\|jsonl\|csv]` | Export prompts |
| `omp import codex-history` | Import from Codex |
| `omp config get\|set\|validate` | Manage configuration |
| `omp db migrate` | Run database migrations |

</details>

<br />

## 📊 Dashboard

The self-hosted web dashboard turns raw prompts into insights.

<table>
<tr>
<td width="50%">

**Prompt Journal**
- Full-text search across all prompts
- Filter by project, type, date, tags
- Quality signals on every prompt
- Markdown + syntax highlighting

</td>
<td width="50%">

**Analytics**
- Activity heatmap
- Token usage trends
- Quality score tracking
- Project breakdown
- Session analysis

</td>
</tr>
</table>

<table>
<tr>
<td width="50%">

**Multi-User**
- Email/password auth
- Admin-managed allowlist
- Per-user data isolation
- Individual API tokens

</td>
<td width="50%">

**Security**
- No client credentials needed
- bcrypt password hashing
- httpOnly secure cookies
- Non-root container

</td>
</tr>
</table>

<!-- Screenshot gallery — uncomment when screenshots are available
<details>
<summary><b>Screenshots</b></summary>
<br />
<img src="docs/assets/prompts-list.png" width="400" /> <img src="docs/assets/analytics.png" width="400" />
<img src="docs/assets/prompt-detail.png" width="400" /> <img src="docs/assets/quality-score.png" width="400" />
</details>
-->

<br />

## 🏗 Self-Hosting

### Quick Start

```bash
git clone https://github.com/jiunbae/oh-my-prompt.git
cd oh-my-prompt

docker compose up -d          # Start PostgreSQL
pnpm install && pnpm db:push  # Install deps + migrate
pnpm dev                      # http://localhost:3000
```

### Docker

```bash
docker build -t oh-my-prompt .

docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/prompts \
  oh-my-prompt
```

### Environment Variables

| Variable | Required | Description |
|:---------|:--------:|:------------|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string |
| `MINIO_ENDPOINT` | No | MinIO/S3 endpoint (without protocol) |
| `MINIO_ACCESS_KEY` | No | MinIO access key |
| `MINIO_SECRET_KEY` | No | MinIO secret key |
| `MINIO_BUCKET` | No | Bucket name (default: `oh-my-prompt`) |
| `MINIO_USE_SSL` | No | Use SSL (default: `true`) |

### Kubernetes

Example k8s manifests are in `k8s/`. Update secrets and ingress for your environment.

### Connect CLI → Server

```bash
omp config set server.url https://your-domain.com
omp config set server.token YOUR_TOKEN
omp sync  # verify connection
```

<br />

## 🏛 Architecture

```
oh-my-prompt/
├── src/app/                    Next.js 16 App Router
│   ├── (dashboard)/            Protected pages (prompts, analytics, admin)
│   └── api/                    REST API (auth, sync, analytics)
├── src/components/             React + Recharts + Shadcn/ui
├── src/db/                     Drizzle ORM schema (PostgreSQL)
├── src/services/               Business logic (upload, sync, classify)
├── src/omp/                    CLI source (Node.js + SQLite)
├── packages/omp-cli/           Standalone npm package
└── .gitea/workflows/           Gitea CI/CD (Docker build + k8s deploy)
```

<table>
<tr>
<td><b>Frontend</b></td>
<td>Next.js 16 · React 19 · Tailwind CSS 4 · Recharts</td>
</tr>
<tr>
<td><b>Backend</b></td>
<td>Next.js API Routes · tRPC · Zod</td>
</tr>
<tr>
<td><b>Database</b></td>
<td>PostgreSQL · Drizzle ORM</td>
</tr>
<tr>
<td><b>Storage</b></td>
<td>MinIO (S3-compatible)</td>
</tr>
<tr>
<td><b>CLI</b></td>
<td>Node.js · better-sqlite3 · zero runtime deps</td>
</tr>
<tr>
<td><b>Infra</b></td>
<td>Docker · Kubernetes · ArgoCD · Gitea CI</td>
</tr>
</table>

<br />

## 🤝 Contributing

```bash
git clone https://github.com/jiunbae/oh-my-prompt.git
cd oh-my-prompt
pnpm install
pnpm dev          # Web dashboard
pnpm build:cli    # Build CLI package
```

1. Fork → 2. Branch (`feat/thing`) → 3. Commit → 4. PR

<br />

## 📄 License

[MIT](LICENSE) — [Jiun Bae](https://github.com/jiunbae)

<div align="center">

<br />

**[GitHub](https://github.com/jiunbae/oh-my-prompt)** · **[npm](https://www.npmjs.com/package/oh-my-prompt)** · **[Issues](https://github.com/jiunbae/oh-my-prompt/issues)**

<sub>Built for developers who talk to AI all day.</sub>

</div>
