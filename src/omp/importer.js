const fs = require("fs");
const path = require("path");
const { ingestPayload } = require("./ingest");

function resolveCodexHistoryPath(customPath) {
  if (customPath) return customPath;
  const home = require("os").homedir();
  const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
  return path.join(codexHome, "history.jsonl");
}

function parseHistoryLine(line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch (error) {
    return null;
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const timestamp = entry.timestamp || entry.time || entry.created_at;
  // Some exporters omit timestamps; ingest will default to now().

  const inputMessages =
    entry["input-messages"] || entry.input_messages || entry.input || entry.prompt;
  const outputMessage =
    entry["last-assistant-message"] || entry.last_assistant_message || entry.output || entry.response;

  let promptText = "";
  if (Array.isArray(inputMessages)) {
    promptText = inputMessages.filter(Boolean).join("\n");
  } else if (inputMessages) {
    promptText = String(inputMessages);
  }
  const responseText = outputMessage ? String(outputMessage) : "";

  if (!promptText && !responseText) return null;

  return {
    timestamp,
    source: "codex",
    session_id: entry["thread-id"] || entry.thread_id || entry.session_id || "",
    project: entry.project || "",
    cwd: entry.cwd || "",
    role: "user",
    text: promptText,
    response_text: responseText,
    model: entry.model || "",
    cli_name: "codex",
    cli_version: entry["cli-version"] || entry.cli_version || "",
    hook_version: "1.0.0",
    capture_response: true,
    meta: {
      turn_id: entry["turn-id"] || entry.turn_id || "",
      event_type: entry.type || "history",
    },
  };
}

async function importCodexHistory(config, options = {}) {
  const historyPath = resolveCodexHistoryPath(options.path);
  if (!fs.existsSync(historyPath)) {
    return { imported: 0, skipped: 0, path: historyPath, error: "history.jsonl not found" };
  }

  const lines = fs.readFileSync(historyPath, "utf-8").split("\n").filter(Boolean);
  const parsed = lines.map(parseHistoryLine);
  const payloads = parsed.filter(Boolean);

  let imported = 0;
  let skipped = parsed.length - payloads.length;

  for (const payload of payloads) {
    if (options.dryRun) {
      imported += 1;
      continue;
    }

    const result = ingestPayload(JSON.stringify(payload), config);
    if (result.ok) {
      imported += 1;
    } else {
      skipped += 1;
    }
  }

  return { imported, skipped, path: historyPath };
}

module.exports = {
  importCodexHistory,
};
