const fs = require("fs");
const path = require("path");
const os = require("os");
const { pathToFileURL } = require("url");
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
  # Claude Code sends: { prompt, session_id, cwd, hook_event_name, ... }
  # Map "prompt" field to "text" and add source metadata for omp ingest
  enriched=$(node -e "
    const p = JSON.parse(process.argv[1]);
    const out = {
      ...p,
      text: p.prompt || p.text || p.prompt_text || '',
      source: p.source || 'claude-code',
      cli_name: p.cli_name || 'claude',
    };
    console.log(JSON.stringify(out));
  " "$payload" 2>/dev/null) || enriched="$payload"

  printf '%s\\n' "$enriched" | "$OMP_BIN" ingest --stdin || true
  exit 0
fi
`;
}

function claudeStopHookScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

OMP_BIN="\${OMP_BIN:-omp}"

payload="$(cat || true)"
if [ -z "$payload" ]; then exit 0; fi

# Capture only the LAST assistant response from the transcript.
# Stop fires after each turn, so we only need the most recent one.
response=$(OMP_PAYLOAD="$payload" node << 'NODESCRIPT'
const fs = require('fs');
const p = JSON.parse(process.env.OMP_PAYLOAD);
if (p.hook_event_name !== 'Stop') process.exit(0);
const sid = p.session_id;
const tp = p.transcript_path;
if (!sid || !tp) process.exit(0);

let rawLines;
try { rawLines = fs.readFileSync(tp, 'utf-8').split('\\n').filter(Boolean); }
catch { process.exit(0); }

const entries = [];
for (const raw of rawLines) {
  try { entries.push(JSON.parse(raw)); } catch {}
}
if (entries.length === 0) process.exit(0);

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(b => b.type === 'text').map(b => b.text).join('\\n');
  }
  return '';
}

function isReal(entry) {
  if ((entry.type || entry.role) !== 'user') return false;
  const c = entry.message?.content || entry.content;
  if (typeof c !== 'string') return false;
  const t = c.trim();
  if (!t) return false;
  if (t.startsWith('<local-command-')) return false;
  if (t.startsWith('<command-name>')) return false;
  if (t.startsWith('<task-notification>')) return false;
  if (t.startsWith('<system-reminder>')) return false;
  if (t.startsWith('This session is being continued')) return false;
  if (t.startsWith('Stop hook feedback:')) return false;
  if (t === '[Request interrupted by user]') return false;
  if (/^\\s*(Claude Code|[\\u2590\\u259B])/.test(t)) return false;
  return true;
}

// Walk backward to find the last real user message
let lastUserIdx = -1;
for (let i = entries.length - 1; i >= 0; i--) {
  if (isReal(entries[i])) { lastUserIdx = i; break; }
}
if (lastUserIdx === -1) process.exit(0);

// Collect all assistant text from lastUserIdx+1 to end
const parts = [];
let cwd = '';
for (let i = lastUserIdx + 1; i < entries.length; i++) {
  const e = entries[i];
  if ((e.type || e.role) !== 'assistant') continue;
  const c = e.message?.content || e.content;
  if (!c) continue;
  const t = extractText(c);
  if (t.trim()) parts.push(t);
  if (e.cwd) cwd = e.cwd;
}
if (parts.length === 0) process.exit(0);

const uc = entries[lastUserIdx].message?.content || entries[lastUserIdx].content;
const userText = typeof uc === 'string' ? uc : '';

console.log(JSON.stringify({
  session_id: sid,
  role: 'assistant',
  text: parts.join('\\n\\n'),
  user_prompt_text: userText,
  source: 'claude-code',
  cli_name: 'claude',
  cwd: cwd || p.cwd || '',
  project: p.project || '',
  capture_response: true,
}));
NODESCRIPT
) || exit 0

if [ -n "$response" ]; then
  printf '%s\\n' "$response" | "$OMP_BIN" ingest --stdin || true
fi
exit 0
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
  ? event["input-messages"].join("\\n")
  : Array.isArray(event.input_messages)
    ? event.input_messages.join("\\n")
    : String(event["input-messages"] || event.input_messages || "");

const responseText = event["last-assistant-message"] || event.last_assistant_message || "";
if (!inputMessages && !responseText) {
  process.exit(0);
}

const threadId = event["thread-id"] || event.thread_id || "";
const turnId = event["turn-id"] || event.turn_id || "";

const payload = {
  timestamp: new Date().toISOString(),
  event_id: turnId ? "codex:" + threadId + ":" + turnId : undefined,
  source: "codex",
  session_id: threadId,
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

function runCommand(cmdSpec) {
  try {
    if (Array.isArray(cmdSpec) && cmdSpec.length > 0) {
      spawnSync(cmdSpec[0], cmdSpec.slice(1).concat([raw]), { stdio: "ignore" });
      return;
    }
    if (typeof cmdSpec === "string" && cmdSpec.trim()) {
      // Preserve string notify commands by running via sh -lc and passing raw as $1.
      spawnSync("sh", ["-lc", cmdSpec, "omp-codex-notify", raw], { stdio: "ignore" });
    }
  } catch (error) {
    // ignore
  }
}

if (chain && (Array.isArray(chain.original) || typeof chain.original === "string")) {
  runCommand(chain.original);
}

runCommand(["node", "${notifyScriptPath}"]);
process.exit(0);
`;
}

function getClaudeHookPath() {
  return path.join(os.homedir(), ".claude", "hooks", "prompt-logger.sh");
}

function getClaudeStopHookPath() {
  return path.join(os.homedir(), ".claude", "hooks", "stop-capture.sh");
}

function getClaudeSettingsPath() {
  return path.join(os.homedir(), ".claude", "settings.json");
}

function ensureClaudeSettingsHook(eventName, scriptPath) {
  const settingsPath = getClaudeSettingsPath();
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      settings = {};
    }
  }

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks[eventName]) settings.hooks[eventName] = [];

  const command = `bash ${scriptPath}`;
  const hookEntries = settings.hooks[eventName];

  // Check if our hook is already registered
  const exists = hookEntries.some((entry) => {
    if (entry.hooks) {
      return entry.hooks.some((h) => h.command && h.command.includes(scriptPath));
    }
    return entry.command && entry.command.includes(scriptPath);
  });

  if (!exists) {
    hookEntries.push({
      hooks: [
        {
          type: "command",
          command: command,
        },
      ],
    });
  }

  ensureDir(path.dirname(settingsPath));
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return settingsPath;
}

function removeClaudeSettingsHook(eventName, scriptPath) {
  const settingsPath = getClaudeSettingsPath();
  if (!fs.existsSync(settingsPath)) return;

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    return;
  }

  if (!settings.hooks || !settings.hooks[eventName]) return;

  settings.hooks[eventName] = settings.hooks[eventName].filter((entry) => {
    if (entry.hooks) {
      return !entry.hooks.some((h) => h.command && h.command.includes(scriptPath));
    }
    return !(entry.command && entry.command.includes(scriptPath));
  });

  if (settings.hooks[eventName].length === 0) {
    delete settings.hooks[eventName];
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
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

function getOpenCodeConfigDir() {
  if (process.env.OPENCODE_CONFIG_HOME) return process.env.OPENCODE_CONFIG_HOME;
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "opencode");
}

function getOpenCodeConfigPath() {
  return path.join(getOpenCodeConfigDir(), "opencode.json");
}

function getOpenCodePluginPath() {
  return path.join(getHooksDir(), "opencode", "omp-opencode-plugin.mjs");
}

function getOpenCodePluginCandidates(scriptPath) {
  const candidates = new Set([scriptPath]);
  try {
    candidates.add(pathToFileURL(scriptPath).href);
  } catch {
    // ignore
  }
  return candidates;
}

function hasOpenCodePlugin(pluginEntries, scriptPath) {
  if (!Array.isArray(pluginEntries)) return false;
  const candidates = getOpenCodePluginCandidates(scriptPath);
  return pluginEntries.some((entry) => typeof entry === "string" && candidates.has(entry));
}

function buildNotifyLine(cmdArray) {
  // Codex config.toml expects notify as a string command
  return `"${cmdArray.join(" ")}"`;
}

function opencodePluginScript() {
  return `import path from "node:path";
import { spawnSync } from "node:child_process";

function normalizeResponse(response) {
  if (response && typeof response === "object" && "data" in response && response.data != null) {
    return response.data;
  }
  return response;
}

function extractText(parts, role) {
  if (!Array.isArray(parts)) return "";
  const chunks = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      if (part.synthetic) continue;
      chunks.push(part.text.trim());
      continue;
    }
    if (role === "assistant" && part.type === "tool_result") {
      if (typeof part.content === "string" && part.content.trim()) {
        chunks.push(part.content.trim());
        continue;
      }
      if (Array.isArray(part.content)) {
        const text = part.content
          .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object" && typeof item.text === "string") return item.text;
            return "";
          })
          .filter(Boolean)
          .join("\\n");
        if (text.trim()) chunks.push(text.trim());
      }
    }
  }
  return chunks.join("\\n\\n").trim();
}

function findLatestTurn(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const assistantEntry = messages[i];
    const assistantInfo = assistantEntry && assistantEntry.info;
    if (!assistantInfo || assistantInfo.role !== "assistant") continue;

    const assistantText = extractText(assistantEntry.parts, "assistant");
    if (!assistantText) continue;

    for (let j = i - 1; j >= 0; j -= 1) {
      const userEntry = messages[j];
      const userInfo = userEntry && userEntry.info;
      if (!userInfo || userInfo.role !== "user") continue;

      const userText = extractText(userEntry.parts, "user");
      if (!userText) continue;
      if (assistantInfo.parentID && assistantInfo.parentID !== userInfo.id) continue;

      return { userEntry, assistantEntry, userText, assistantText };
    }
  }

  return null;
}

export default async function OhMyPromptOpenCodePlugin(ctx) {
  return {
    event: async ({ event }) => {
      if (!event || event.type !== "session.idle") return;
      const sessionID = event.properties && event.properties.sessionID;
      if (!sessionID) return;

      let messagesResp;
      try {
        messagesResp = await ctx.client.session.messages({ path: { id: sessionID } });
      } catch {
        return;
      }

      const messages = normalizeResponse(messagesResp);
      const latest = findLatestTurn(messages);
      if (!latest) return;

      const { userEntry, assistantEntry, userText, assistantText } = latest;
      const assistantInfo = assistantEntry.info || {};
      const userInfo = userEntry.info || {};

      const cwd =
        (assistantInfo.path && assistantInfo.path.cwd) ||
        (userInfo.path && userInfo.path.cwd) ||
        ctx.directory ||
        process.cwd();
      const root =
        (assistantInfo.path && assistantInfo.path.root) ||
        (userInfo.path && userInfo.path.root) ||
        cwd;

      const payload = {
        timestamp: new Date().toISOString(),
        event_id: \`opencode:\${sessionID}:\${userInfo.id || ""}:\${assistantInfo.id || ""}\`,
        source: "opencode",
        session_id: sessionID,
        project: path.basename(root || cwd || ""),
        cwd,
        role: "user",
        text: userText,
        response_text: assistantText,
        model:
          assistantInfo.providerID && assistantInfo.modelID
            ? \`\${assistantInfo.providerID}/\${assistantInfo.modelID}\`
            : "",
        cli_name: "opencode",
        hook_version: "1.0.0",
        capture_response: true,
        meta: {
          event_type: event.type,
          user_message_id: userInfo.id || "",
          assistant_message_id: assistantInfo.id || "",
          agent: assistantInfo.agent || userInfo.agent || "",
          variant: assistantInfo.variant || userInfo.variant || "",
        },
      };

      const ompBin = process.env.OMP_BIN || "omp";
      spawnSync(ompBin, ["ingest", "--stdin", "--source", "opencode"], {
        input: JSON.stringify(payload),
        encoding: "utf-8",
      });
    },
  };
}
`;
}

function installClaudeHook() {
  const hookPath = getClaudeHookPath();
  const stopHookPath = getClaudeStopHookPath();
  ensureDir(path.dirname(hookPath));

  // Write prompt capture hook
  fs.writeFileSync(hookPath, claudeHookScript());
  makeExecutable(hookPath);

  // Write response capture hook (Stop event)
  fs.writeFileSync(stopHookPath, claudeStopHookScript());
  makeExecutable(stopHookPath);

  // Register both hooks in Claude settings.json
  ensureClaudeSettingsHook("UserPromptSubmit", hookPath);
  ensureClaudeSettingsHook("Stop", stopHookPath);

  return hookPath;
}

function uninstallClaudeHook() {
  const hookPath = getClaudeHookPath();
  const stopHookPath = getClaudeStopHookPath();
  let removed = null;

  if (fs.existsSync(hookPath)) {
    fs.unlinkSync(hookPath);
    removed = hookPath;
  }
  if (fs.existsSync(stopHookPath)) {
    fs.unlinkSync(stopHookPath);
  }

  // Remove from Claude settings.json
  removeClaudeSettingsHook("UserPromptSubmit", hookPath);
  removeClaudeSettingsHook("Stop", stopHookPath);

  return removed;
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
  const mergeable = Array.isArray(parsed) || (typeof parsed === "string" && parsed.trim());
  if (!mergeable) {
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
      if (chain && (Array.isArray(chain.original) || typeof chain.original === "string")) {
        const restoredLine = Array.isArray(chain.original)
          ? buildNotifyLine(chain.original)
          : JSON.stringify(chain.original);
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

function installOpenCodeHook() {
  const scriptPath = getOpenCodePluginPath();
  const configPath = getOpenCodeConfigPath();

  ensureDir(path.dirname(scriptPath));
  fs.writeFileSync(scriptPath, opencodePluginScript());

  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (error) {
      throw new Error(`OpenCode config is not valid JSON: ${error.message}`);
    }
  }

  if (!config || typeof config !== "object") {
    throw new Error("OpenCode config has unexpected format");
  }
  if (!config.$schema) {
    config.$schema = "https://opencode.ai/config.json";
  }
  if (config.plugin === undefined) {
    config.plugin = [];
  }
  if (!Array.isArray(config.plugin)) {
    return { scriptPath, configPath, configured: false, conflict: true };
  }

  if (!hasOpenCodePlugin(config.plugin, scriptPath)) {
    config.plugin.push(scriptPath);
  }

  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

  return { scriptPath, configPath, configured: true, conflict: false };
}

function uninstallOpenCodeHook() {
  const scriptPath = getOpenCodePluginPath();
  const configPath = getOpenCodeConfigPath();
  let removed = false;

  if (fs.existsSync(scriptPath)) {
    fs.unlinkSync(scriptPath);
    removed = true;
  }

  let configUpdated = false;
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (config && typeof config === "object" && Array.isArray(config.plugin)) {
        const candidates = getOpenCodePluginCandidates(scriptPath);
        const next = config.plugin.filter(
          (item) => !(typeof item === "string" && candidates.has(item))
        );
        if (next.length !== config.plugin.length) {
          config.plugin = next;
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
          configUpdated = true;
        }
      }
    } catch {
      // ignore parse errors on uninstall
    }
  }

  return {
    scriptPath,
    configPath,
    removed,
    configUpdated,
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

  const opencodeConfigPath = getOpenCodeConfigPath();
  const opencodeScriptPath = getOpenCodePluginPath();
  let opencodeConfigured = false;
  if (fs.existsSync(opencodeConfigPath) && fs.existsSync(opencodeScriptPath)) {
    try {
      const opencodeConfig = JSON.parse(fs.readFileSync(opencodeConfigPath, "utf-8"));
      if (opencodeConfig && Array.isArray(opencodeConfig.plugin)) {
        opencodeConfigured = hasOpenCodePlugin(opencodeConfig.plugin, opencodeScriptPath);
      }
    } catch {
      opencodeConfigured = false;
    }
  }

  return {
    claude_code: fs.existsSync(getClaudeHookPath()),
    claude_code_stop: fs.existsSync(getClaudeStopHookPath()),
    codex: codexConfigured,
    opencode: opencodeConfigured,
  };
}

module.exports = {
  installClaudeHook,
  uninstallClaudeHook,
  installCodexHook,
  uninstallCodexHook,
  installOpenCodeHook,
  uninstallOpenCodeHook,
  listHookStatus,
};
