const fs = require("fs");
const path = require("path");
const os = require("os");
const { ensureDir, getHooksDir } = require("./paths");
const { parseTomlValue, findTomlLine, setTomlLine, removeTomlLine } = require("./toml");

const OMP_MARKER = "# Added by Oh My Prompt";

function makeExecutable(filePath) {
  fs.chmodSync(filePath, 0o755);
}

function claudeHookScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

OMP_BIN="\${OMP_BIN:-omp}"

payload="$(cat || true)"
if [ -n "$payload" ]; then
  # Enrich stdin payload with env vars that Claude Code exposes
  enriched=$(printf '%s' "$payload" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      const p=JSON.parse(d);
      if(!p.project)p.project=process.env.CLAUDE_PROJECT||process.env.PROJECT||'';
      if(!p.cwd)p.cwd=process.env.PWD||'';
      if(!p.session_id)p.session_id=process.env.CLAUDE_SESSION_ID||process.env.SESSION_ID||'';
      if(!p.model)p.model=process.env.CLAUDE_MODEL||process.env.MODEL||'';
      console.log(JSON.stringify(p));
    });
  " 2>/dev/null) || enriched="$payload"
  printf '%s\\n' "$enriched" | "$OMP_BIN" ingest --stdin --source claude-code || true
  exit 0
fi

node - <<'NODE'
const env = process.env;
const payload = {
  timestamp: new Date().toISOString(),
  source: 'claude-code',
  session_id: env.CLAUDE_SESSION_ID || env.SESSION_ID || '',
  project: env.CLAUDE_PROJECT || env.PROJECT || '',
  cwd: env.PWD || '',
  role: env.CLAUDE_HOOK_ROLE || env.ROLE || 'user',
  text: env.CLAUDE_PROMPT || env.CLAUDE_INPUT || env.PROMPT || '',
  response_text: env.CLAUDE_RESPONSE || env.RESPONSE || '',
  model: env.CLAUDE_MODEL || env.MODEL || '',
  cli_name: 'claude',
  cli_version: env.CLAUDE_VERSION || '',
  hook_version: '1.0.0',
  capture_response: true,
};
if (!payload.text) process.exit(0);
console.log(JSON.stringify(payload));
NODE

if [ $? -eq 0 ]; then
  "$OMP_BIN" ingest --stdin --source claude-code || true
fi
`;
}

function codexNotifyScript() {
  return `#!/usr/bin/env node
const { spawnSync } = require("child_process");

const raw = process.argv[2];
if (!raw) process.exit(0);

let event;
try {
  event = JSON.parse(raw);
} catch (error) {
  process.exit(0);
}

if (!event || event.type !== "agent-turn-complete") {
  process.exit(0);
}

const inputMessages = Array.isArray(event["input-messages"])
  ? event["input-messages"].join("\n")
  : Array.isArray(event.input_messages)
    ? event.input_messages.join("\n")
    : String(event["input-messages"] || event.input_messages || "");

const responseText = event["last-assistant-message"] || event.last_assistant_message || "";
if (!inputMessages && !responseText) {
  process.exit(0);
}

const payload = {
  timestamp: new Date().toISOString(),
  source: "codex",
  session_id: event["thread-id"] || event.thread_id || "",
  project: event.project || "",
  cwd: event.cwd || "",
  role: "user",
  text: inputMessages,
  response_text: responseText,
  model: event.model || "",
  cli_name: "codex",
  cli_version: event["cli-version"] || event.cli_version || "",
  hook_version: "1.0.0",
  capture_response: true,
  meta: {
    turn_id: event["turn-id"] || event.turn_id || "",
    event_type: event.type || "",
  },
};

const ompBin = process.env.OMP_BIN || "omp";
const result = spawnSync(ompBin, ["ingest", "--stdin", "--source", "codex"], {
  input: JSON.stringify(payload),
  encoding: "utf-8",
});

if (result.error) {
  process.exit(1);
}
`;
}

function codexWrapperScript(chainPath, notifyScriptPath) {
  return `#!/usr/bin/env node
const fs = require("fs");
const { spawnSync } = require("child_process");

const raw = process.argv[2];
if (!raw) process.exit(0);

let chain = null;
try {
  chain = JSON.parse(fs.readFileSync("${chainPath}", "utf-8"));
} catch (error) {
  chain = null;
}

function runCommand(cmdArray) {
  if (!Array.isArray(cmdArray) || cmdArray.length === 0) return;
  try {
    spawnSync(cmdArray[0], cmdArray.slice(1).concat([raw]), { stdio: "ignore" });
  } catch (error) {
    // ignore
  }
}

if (chain && Array.isArray(chain.original)) {
  runCommand(chain.original);
}

runCommand(["node", "${notifyScriptPath}"]);
process.exit(0);
`;
}

function getClaudeHookPath() {
  return path.join(os.homedir(), ".claude", "hooks", "prompt-logger.sh");
}

function getCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function getCodexConfigPath() {
  return path.join(getCodexHome(), "config.toml");
}

function getCodexNotifyScriptPath() {
  return path.join(getHooksDir(), "codex", "notify.js");
}

function getCodexWrapperScriptPath() {
  return path.join(getHooksDir(), "codex", "notify-wrapper.js");
}

function getCodexChainPath() {
  return path.join(getHooksDir(), "codex", "notify-chain.json");
}

function buildNotifyLine(cmdArray) {
  // Codex config.toml expects notify as a string command, not an array
  return `"${cmdArray.join(" ")}"`;
}

function installClaudeHook() {
  const hookPath = getClaudeHookPath();
  ensureDir(path.dirname(hookPath));
  fs.writeFileSync(hookPath, claudeHookScript());
  makeExecutable(hookPath);
  return hookPath;
}

function uninstallClaudeHook() {
  const hookPath = getClaudeHookPath();
  if (fs.existsSync(hookPath)) {
    fs.unlinkSync(hookPath);
    return hookPath;
  }
  return null;
}

function ensureCodexNotifyConfig(scriptPath, wrapperPath, chainPath) {
  const configPath = getCodexConfigPath();
  const notifyKey = "notify";
  const notifyLine = buildNotifyLine(["node", scriptPath]);
  const wrapperLine = buildNotifyLine(["node", wrapperPath]);

  let content = "";
  if (fs.existsSync(configPath)) {
    content = fs.readFileSync(configPath, "utf-8");
  }

  const info = findTomlLine(content, notifyKey);
  if (!info) {
    const newContent = setTomlLine(content, notifyKey, notifyLine, OMP_MARKER);
    ensureDir(path.dirname(configPath));
    fs.writeFileSync(configPath, newContent);
    return { configPath, configured: true, conflict: false, merged: false };
  }

  if (info.line.includes(scriptPath) || info.line.includes(wrapperPath)) {
    return { configPath, configured: true, conflict: false, merged: false };
  }

  const parsed = parseTomlValue(info.value);
  if (!Array.isArray(parsed)) {
    return { configPath, configured: false, conflict: true, merged: false };
  }

  const chainPayload = {
    original: parsed,
  };
  ensureDir(path.dirname(chainPath));
  fs.writeFileSync(chainPath, JSON.stringify(chainPayload, null, 2));

  const newContent = setTomlLine(content, notifyKey, wrapperLine, OMP_MARKER);
  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, newContent);

  return { configPath, configured: true, conflict: false, merged: true };
}

function restoreCodexNotifyConfig(scriptPath, wrapperPath, chainPath) {
  const configPath = getCodexConfigPath();
  if (!fs.existsSync(configPath)) {
    return { configPath, restored: false, removed: false };
  }

  let content = fs.readFileSync(configPath, "utf-8");
  const info = findTomlLine(content, "notify");
  if (!info) {
    return { configPath, restored: false, removed: false };
  }

  const isOurLine = info.line.includes(scriptPath) || info.line.includes(wrapperPath);
  if (!isOurLine) {
    return { configPath, restored: false, removed: false };
  }

  let restored = false;
  let removed = false;

  if (fs.existsSync(chainPath)) {
    try {
      const chain = JSON.parse(fs.readFileSync(chainPath, "utf-8"));
      if (chain && Array.isArray(chain.original)) {
        const restoredLine = buildNotifyLine(chain.original);
        content = setTomlLine(content, "notify", restoredLine, "");
        restored = true;
      }
    } catch (error) {
      // ignore
    }
  }

  if (!restored) {
    content = removeTomlLine(content, "notify");
    removed = true;
  }

  fs.writeFileSync(configPath, content);
  return { configPath, restored, removed };
}

function installCodexHook() {
  const scriptPath = getCodexNotifyScriptPath();
  const wrapperPath = getCodexWrapperScriptPath();
  const chainPath = getCodexChainPath();

  ensureDir(path.dirname(scriptPath));
  fs.writeFileSync(scriptPath, codexNotifyScript());
  makeExecutable(scriptPath);

  fs.writeFileSync(wrapperPath, codexWrapperScript(chainPath, scriptPath));
  makeExecutable(wrapperPath);

  const result = ensureCodexNotifyConfig(scriptPath, wrapperPath, chainPath);
  return {
    scriptPath,
    wrapperPath,
    chainPath,
    configPath: result.configPath,
    configured: result.configured,
    conflict: result.conflict,
    merged: result.merged,
  };
}

function uninstallCodexHook() {
  const scriptPath = getCodexNotifyScriptPath();
  const wrapperPath = getCodexWrapperScriptPath();
  const chainPath = getCodexChainPath();

  if (fs.existsSync(scriptPath)) {
    fs.unlinkSync(scriptPath);
  }
  if (fs.existsSync(wrapperPath)) {
    fs.unlinkSync(wrapperPath);
  }

  const restoration = restoreCodexNotifyConfig(scriptPath, wrapperPath, chainPath);
  if (fs.existsSync(chainPath)) {
    fs.unlinkSync(chainPath);
  }

  return {
    scriptPath,
    wrapperPath,
    configPath: restoration.configPath,
    restored: restoration.restored,
    removed: restoration.removed,
  };
}

function listHookStatus() {
  const configPath = getCodexConfigPath();
  let codexConfigured = false;
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, "utf-8");
    const info = findTomlLine(content, "notify");
    if (info) {
      const scriptPath = getCodexNotifyScriptPath();
      const wrapperPath = getCodexWrapperScriptPath();
      codexConfigured = info.line.includes(scriptPath) || info.line.includes(wrapperPath);
    }
  }

  return {
    claude_code: fs.existsSync(getClaudeHookPath()),
    codex: codexConfigured,
  };
}

module.exports = {
  installClaudeHook,
  uninstallClaudeHook,
  installCodexHook,
  uninstallCodexHook,
  listHookStatus,
};
