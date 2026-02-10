const fs = require("fs");
const path = require("path");
const os = require("os");
const { hashContent } = require("./db");
const { ingestPayload } = require("./ingest");

const SYSTEM_PREFIXES = [
  "<local-command-caveat>",
  "<local-command-",
  "<command-name>",
  "<task-notification>",
  "<system-reminder>",
  "This session is being continued",
  "Stop hook feedback:",
];

function isRealUserMessage(entry) {
  if ((entry.type || entry.role) !== "user") return false;
  const content = entry.message?.content || entry.content;
  if (typeof content !== "string") return false;
  const trimmed = content.trim();
  if (!trimmed) return false;

  for (const prefix of SYSTEM_PREFIXES) {
    if (trimmed.startsWith(prefix)) return false;
  }
  if (trimmed === "[Request interrupted by user]") return false;
  // CLI header (starts with whitespace + "Claude Code" or unicode box chars)
  if (/^\s*(Claude Code|[\u2590\u259B])/.test(trimmed)) return false;

  return true;
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

function parseTranscript(lines) {
  const entries = [];
  for (const raw of lines) {
    try {
      entries.push(JSON.parse(raw));
    } catch {}
  }

  const turns = [];
  let current = null;

  for (const entry of entries) {
    if (isRealUserMessage(entry)) {
      const content = entry.message?.content || entry.content;
      const text = extractText(content);
      current = {
        userText: text,
        responseParts: [],
        cwd: entry.cwd || "",
        timestamp: entry.timestamp || null,
      };
      turns.push(current);
    } else if ((entry.type || entry.role) === "assistant" && current) {
      const content = entry.message?.content || entry.content;
      if (!content) continue;
      const text = extractText(content);
      if (text.trim()) {
        current.responseParts.push(text);
        if (entry.cwd) current.cwd = entry.cwd;
      }
    }
  }

  return turns.map((turn) => ({
    userText: turn.userText,
    responseText: turn.responseParts.length > 0 ? turn.responseParts.join("\n\n") : null,
    cwd: turn.cwd,
    timestamp: turn.timestamp,
  }));
}

function buildEventId(sessionId, userText) {
  return hashContent(
    JSON.stringify({
      source: "claude-code",
      session_id: sessionId,
      role: "user",
      prompt_text: userText,
      response_text: "",
    })
  );
}

function scanTranscriptPaths(customPath) {
  if (customPath) {
    if (!fs.existsSync(customPath)) {
      throw new Error(`File not found: ${customPath}`);
    }
    return [customPath];
  }

  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(projectsDir)) return [];

  const results = [];
  const projectDirs = fs.readdirSync(projectsDir);
  for (const dir of projectDirs) {
    const dirPath = path.join(projectsDir, dir);
    try {
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      results.push(path.join(dirPath, file));
    }
  }
  return results;
}

function backfillTranscripts(config, options = {}) {
  const paths = scanTranscriptPaths(options.path);
  let totalImported = 0;
  let totalSkipped = 0;
  let totalDuplicates = 0;
  const fileResults = [];

  for (const filePath of paths) {
    let lines;
    try {
      lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    } catch {
      fileResults.push({ path: filePath, turns: 0, imported: 0, skipped: 0, duplicates: 0, error: "read failed" });
      continue;
    }

    const turns = parseTranscript(lines);
    const filename = path.basename(filePath, ".jsonl");
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;

    for (const turn of turns) {
      if (!turn.userText.trim()) {
        skipped++;
        continue;
      }

      const sessionId = filename;
      const eventId = buildEventId(sessionId, turn.userText);

      const payload = {
        timestamp: turn.timestamp || new Date().toISOString(),
        source: "claude-code",
        session_id: sessionId,
        role: "user",
        text: turn.userText,
        response_text: turn.responseText,
        cwd: turn.cwd || "",
        project: turn.cwd ? path.basename(turn.cwd) : null,
        cli_name: "claude",
        capture_response: true,
        event_id: eventId,
      };

      if (options.dryRun) {
        imported++;
        continue;
      }

      const result = ingestPayload(payload, config);
      if (result.ok) {
        if (result.deduped) {
          duplicates++;
        } else {
          imported++;
        }
      } else {
        skipped++;
      }
    }

    fileResults.push({
      path: filePath,
      turns: turns.length,
      imported,
      skipped,
      duplicates,
    });
    totalImported += imported;
    totalSkipped += skipped;
    totalDuplicates += duplicates;
  }

  return {
    files: paths.length,
    totalImported,
    totalSkipped,
    totalDuplicates,
    fileResults,
  };
}

function getCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function getCodexHistoryPath() {
  return path.join(getCodexHome(), "history.jsonl");
}

function scanCodexSessionPaths() {
  const sessionsDir = path.join(getCodexHome(), "sessions");
  if (!fs.existsSync(sessionsDir)) return [];

  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  }
  walk(sessionsDir);
  return results;
}

function parseCodexSession(filePath) {
  let lines;
  try {
    lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  } catch {
    return { sessionId: null, cwd: "", turns: [] };
  }

  let sessionId = null;
  let cwd = "";
  const turns = [];
  let currentUser = null;

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "session_meta" && entry.payload) {
      sessionId = entry.payload.id || null;
      cwd = entry.payload.cwd || "";
    }

    if (entry.type === "event_msg" && entry.payload) {
      const p = entry.payload;
      if (p.type === "user_message" && p.message) {
        if (currentUser) {
          turns.push(currentUser);
        }
        currentUser = {
          userText: p.message,
          responseText: null,
          timestamp: entry.timestamp || null,
        };
      } else if (p.type === "agent_message" && p.message && currentUser) {
        currentUser.responseText = p.message;
      }
    }
  }

  if (currentUser) {
    turns.push(currentUser);
  }

  return { sessionId, cwd, turns };
}

function backfillCodex(config, options = {}) {
  const sessionPaths = scanCodexSessionPaths();
  const historyPath = getCodexHistoryPath();

  // Build a map of session responses from transcript files
  const sessionResponses = new Map();
  for (const sp of sessionPaths) {
    const parsed = parseCodexSession(sp);
    if (parsed.sessionId && parsed.turns.length > 0) {
      sessionResponses.set(parsed.sessionId, parsed);
    }
  }

  // Read history.jsonl for the canonical list of user prompts
  if (!fs.existsSync(historyPath)) {
    return { entries: 0, imported: 0, skipped: 0, duplicates: 0, sessions: sessionResponses.size };
  }

  let lines;
  try {
    lines = fs.readFileSync(historyPath, "utf-8").split("\n").filter(Boolean);
  } catch {
    return { entries: 0, imported: 0, skipped: 0, duplicates: 0, error: "read failed" };
  }

  let imported = 0;
  let skipped = 0;
  let duplicates = 0;

  // Group history entries by session to match with transcript turns
  const sessionHistories = new Map();
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }

    const text = (entry.text || "").trim();
    if (!text) {
      skipped++;
      continue;
    }

    const sid = entry.session_id || "";
    if (!sessionHistories.has(sid)) {
      sessionHistories.set(sid, []);
    }
    sessionHistories.get(sid).push(entry);
  }

  for (const [sessionId, histEntries] of sessionHistories) {
    const session = sessionResponses.get(sessionId);
    const turns = session ? session.turns : [];
    const cwd = session ? session.cwd : "";

    for (let i = 0; i < histEntries.length; i++) {
      const entry = histEntries[i];
      const text = (entry.text || "").trim();

      // Match with transcript turn by index
      const turn = turns[i] || null;
      const responseText = turn ? turn.responseText : null;

      const timestamp = entry.ts
        ? new Date(entry.ts * 1000).toISOString()
        : new Date().toISOString();

      const eventId = hashContent(
        JSON.stringify({
          source: "codex",
          session_id: sessionId,
          role: "user",
          prompt_text: text,
          response_text: "",
        })
      );

      const payload = {
        timestamp,
        source: "codex",
        session_id: sessionId,
        role: "user",
        text,
        response_text: responseText,
        cwd: cwd,
        project: cwd ? path.basename(cwd) : "",
        cli_name: "codex",
        capture_response: !!responseText,
        event_id: eventId,
      };

      if (options.dryRun) {
        imported++;
        continue;
      }

      const result = ingestPayload(payload, config);
      if (result.ok) {
        if (result.deduped) {
          duplicates++;
        } else {
          imported++;
        }
      } else {
        skipped++;
      }
    }
  }

  return {
    entries: lines.length - skipped,
    imported,
    skipped,
    duplicates,
    sessions: sessionResponses.size,
  };
}

module.exports = {
  backfillTranscripts,
  backfillCodex,
  isRealUserMessage,
  extractText,
  parseTranscript,
  scanTranscriptPaths,
};
