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

module.exports = {
  backfillTranscripts,
  isRealUserMessage,
  extractText,
  parseTranscript,
  scanTranscriptPaths,
};
