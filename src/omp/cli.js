const fs = require("fs");
const path = require("path");
const { loadConfig, saveConfig, getConfigSummary } = require("./config");
const {
  installClaudeHook,
  uninstallClaudeHook,
  installCodexHook,
  uninstallCodexHook,
  listHookStatus,
} = require("./hooks");
const { ingestPayload, replayQueue } = require("./ingest");
const { getQueueStats } = require("./queue");
const { loadState } = require("./state");
const { getStats } = require("./stats");
const { exportData } = require("./export");
const { syncToServer, postJson } = require("./sync");
const { getSyncStatus, updateSyncState } = require("./sync-log");
const { openDb } = require("./db");

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  const options = {};
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const [key, inlineValue] = arg.replace(/^--/, "").split("=");
      if (inlineValue !== undefined) {
        options[key] = inlineValue;
        continue;
      }
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        options[key] = true;
      } else {
        options[key] = next;
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, options, positional };
}

function printJson(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.resume();
  });
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return value === "true";
}

function commandExists(cmd) {
  const { spawnSync } = require("child_process");
  const result = spawnSync("which", [cmd], { stdio: "ignore" });
  return result.status === 0;
}

function detectCliTargets() {
  const targets = [];
  const home = require("os").homedir();
  if (commandExists("claude") || fs.existsSync(path.join(home, ".claude"))) {
    targets.push("claude");
  }
  if (commandExists("codex") || fs.existsSync(path.join(home, ".codex"))) {
    targets.push("codex");
  }
  return targets;
}

function resolveCliList(cliOption) {
  if (!cliOption) {
    return detectCliTargets();
  }
  if (cliOption === "all") {
    return ["claude", "codex"];
  }
  return cliOption.split(",").map((entry) => entry.trim());
}

async function handleInstall(options) {
  const config = loadConfig();

  // Server config (new, preferred)
  if (options.server) config.server.url = options.server;
  if (options.token) config.server.token = options.token;

  if (options["sqlite-path"]) config.storage.sqlite.path = options["sqlite-path"];
  if (options["capture-response"] !== undefined) {
    config.capture.response = parseBoolean(options["capture-response"], true);
  }

  const targets = resolveCliList(options.cli);
  if (!targets.length) {
    console.error("No supported CLI detected. Use --cli to specify a target.");
    process.exitCode = 2;
    return [];
  }

  const installed = [];

  if (targets.includes("claude") || targets.includes("claude-code")) {
    const hookPath = installClaudeHook();
    config.hooks.enabled.claude_code = true;
    installed.push({ cli: "claude", path: hookPath });
  }

  if (targets.includes("codex")) {
    const codexResult = installCodexHook();
    config.hooks.enabled.codex = codexResult.configured;
    installed.push({
      cli: "codex",
      path: codexResult.scriptPath,
      configPath: codexResult.configPath,
      configured: codexResult.configured,
      conflict: codexResult.conflict,
      merged: codexResult.merged,
    });
  }

  saveConfig(config);
  return installed;
}

function askConfirm(question, defaultYes = false) {
  const readline = require("readline");
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  > ${question} [${hint}]: `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (!trimmed) return resolve(defaultYes);
      resolve(trimmed === "y" || trimmed === "yes");
    });
  });
}

async function handleUninstall(options) {
  const {
    getConfigDir,
    getConfigPath,
    getDefaultSqlitePath,
  } = require("./paths");

  const isAll = options.all || options.cli === "all";
  const isFull = isAll && !options["hooks-only"];
  const interactive = process.stdin.isTTY && !options.yes && !options.y;

  // If --all flag: full uninstall (hooks + config + data)
  if (isFull) {
    const configDir = getConfigDir();
    const dbPath = getDefaultSqlitePath();
    const dbExists = fs.existsSync(dbPath);
    const configExists = fs.existsSync(getConfigPath());

    let removeDb = true;

    if (interactive) {
      console.log("\n  Oh My Prompt - Full Uninstall");
      console.log("  ==============================\n");
      console.log("  This will remove:");
      console.log("    - Claude Code hook (~/.claude/hooks/prompt-logger.sh)");
      console.log("    - Codex hook (~/.config/oh-my-prompt/hooks/)");
      if (configExists) console.log("    - Configuration (~/.config/oh-my-prompt/config.json)");
      if (dbExists) console.log("    - Local database (~/.config/oh-my-prompt/omp.db)");
      console.log("    - All data in " + configDir);
      console.log("");

      const proceed = await askConfirm("Are you sure you want to remove everything?", false);
      if (!proceed) {
        console.log("\n  Uninstall cancelled.\n");
        return [];
      }

      if (dbExists) {
        removeDb = await askConfirm("Also delete local prompt database (omp.db)?", false);
      }
    }

    console.log("");

    // Remove hooks
    const removed = [];
    try {
      const hookPath = uninstallClaudeHook();
      if (hookPath) {
        removed.push({ cli: "claude", path: hookPath });
        console.log("  Removed Claude Code hook: " + hookPath);
      }
    } catch { /* ignore */ }

    try {
      const codexResult = uninstallCodexHook();
      if (codexResult.scriptPath || codexResult.removed) {
        removed.push({ cli: "codex", path: codexResult.scriptPath });
        console.log("  Removed Codex hook: " + (codexResult.scriptPath || ""));
      }
    } catch { /* ignore */ }

    // Remove config dir contents
    const configDir2 = getConfigDir();
    if (fs.existsSync(configDir2)) {
      const entries = fs.readdirSync(configDir2, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(configDir2, entry.name);
        // Skip database if user chose to keep it
        if (!removeDb && entry.name === "omp.db") continue;
        if (entry.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(fullPath);
        }
      }
      // Remove dir itself if empty
      try {
        const remaining = fs.readdirSync(configDir2);
        if (remaining.length === 0) fs.rmdirSync(configDir2);
      } catch { /* ignore */ }
      console.log("  Removed config directory: " + configDir2);
    }

    if (!removeDb && dbExists) {
      console.log("  Kept local database: " + dbPath);
    }

    console.log("\n  Uninstall complete. Run 'omp setup' to reconfigure.\n");
    return removed;
  }

  // Original behavior: remove specific hooks only
  let config;
  try {
    config = loadConfig();
  } catch {
    config = require("./config").defaultConfig();
  }
  const targets = resolveCliList(options.cli);
  const removed = [];

  if (targets.includes("claude") || targets.includes("claude-code")) {
    const hookPath = uninstallClaudeHook();
    config.hooks.enabled.claude_code = false;
    if (hookPath) removed.push({ cli: "claude", path: hookPath });
  }

  if (targets.includes("codex")) {
    const codexResult = uninstallCodexHook();
    config.hooks.enabled.codex = false;
    if (codexResult.scriptPath || codexResult.removed) {
      removed.push({
        cli: "codex",
        path: codexResult.scriptPath,
        configPath: codexResult.configPath,
        removed: codexResult.removed,
      });
    }
  }

  if (options["remove-config"]) {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  } else {
    saveConfig(config);
  }

  return removed;
}

function handleStatus(options) {
  const config = loadConfig();
  const hooks = listHookStatus();
  const summary = getConfigSummary(config);
  const state = loadState();
  const queueStats = getQueueStats();

  const db = openDb(config.storage.sqlite.path);
  const lastRow = db
    .prepare("SELECT created_at FROM prompts ORDER BY created_at DESC LIMIT 1")
    .get();
  db.close();

  const status = {
    server: summary.serverUrl || "(not configured)",
    serverToken: summary.serverToken,
    storage: summary.storageType,
    sqlitePath: summary.sqlitePath,
    captureResponse: summary.captureResponse,
    hooks,
    lastCapture: lastRow ? lastRow.created_at : null,
    queue: queueStats,
    lastError: state.lastError || null,
    lastReplay: state.lastReplay || null,
  };

  if (options.json) {
    printJson(status);
  } else {
    console.log(`Server: ${status.server}`);
    console.log(`Token: ${status.serverToken}`);
    console.log(`Storage: ${status.storage}`);
    console.log(`SQLite: ${status.sqlitePath}`);
    console.log(`Capture response: ${status.captureResponse ? "on" : "off"}`);
    console.log(`Hooks: claude=${hooks.claude_code ? "installed" : "not installed"}, codex=${hooks.codex ? "installed" : "not installed"}`);
    console.log(`Last capture: ${status.lastCapture || "none"}`);
    console.log(`Queue: ${queueStats.count} files, ${queueStats.bytes} bytes`);
    if (state.lastReplay) {
      console.log(
        `Last replay: ${state.lastReplay.at} (processed ${state.lastReplay.processed}, failed ${state.lastReplay.failed})`
      );
    }
  }
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function setConfigValue(config, keyPath, value) {
  const keys = keyPath.split(".");
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Invalid config key: "${key}" is not allowed`);
    }
  }
  let current = config;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

function parseValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (!Number.isNaN(Number(raw)) && raw.trim() !== "") return Number(raw);
  return raw;
}

function handleConfig(options, positional) {
  const config = loadConfig();
  const action = positional[0];
  const key = positional[1];

  if (action === "set") {
    const value = positional[2];
    if (!key || value === undefined) {
      console.error("Usage: omp config set <path> <value>");
      process.exitCode = 2;
      return;
    }
    setConfigValue(config, key, parseValue(value));
    saveConfig(config);
    if (options.json) {
      printJson({ ok: true, key, value: parseValue(value) });
    } else {
      console.log(`Updated ${key}`);
    }
    return;
  }

  if (action === "validate") {
    const { validateConfig } = require("./doctor");
    const result = validateConfig(config);
    if (options.json) {
      printJson(result);
    } else {
      if (result.ok) {
        console.log("Config OK");
      }
      if (result.errors.length) {
        console.log("Errors:");
        result.errors.forEach((err) => console.log(`- ${err}`));
      }
      if (result.warnings.length) {
        console.log("Warnings:");
        result.warnings.forEach((warn) => console.log(`- ${warn}`));
      }
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (action === "get") {
    if (!key) {
      printJson(config);
      return;
    }
    const value = key
      .split(".")
      .reduce((acc, part) => (acc ? acc[part] : undefined), config);
    if (options.json) {
      printJson({ key, value });
    } else {
      console.log(value === undefined ? "" : value);
    }
    return;
  }

  console.error("Usage: omp config <get|set> [path] [value]");
  process.exitCode = 2;
}

async function handleImport(options, positional) {
  const config = loadConfig();
  const source = positional[0];
  if (source !== "codex-history") {
    console.error("Usage: omp import codex-history [--path <file>] [--dry-run]");
    process.exitCode = 2;
    return;
  }
  const { importCodexHistory } = require("./importer");
  const result = await importCodexHistory(config, {
    path: options.path,
    dryRun: !!options["dry-run"],
  });
  if (options.json) {
    printJson(result);
  } else {
    console.log(`Imported ${result.imported} records (skipped ${result.skipped}).`);
  }
}

function handleStats(options) {
  const config = loadConfig();
  const stats = getStats(config, {
    since: options.since,
    until: options.until,
    groupBy: options["group-by"],
  });

  if (options.json) {
    printJson(stats);
    return;
  }

  console.log("Overall:");
  console.log(stats.overall);
  if (stats.grouped) {
    console.log("Grouped:");
    console.table(stats.grouped);
  }
}

function handleExport(options) {
  const config = loadConfig();
  const result = exportData(config, {
    format: options.format,
    since: options.since,
    until: options.until,
    out: options.out,
  });

  if (!options.out) {
    process.stdout.write(result.output);
  } else if (options.json) {
    printJson({ count: result.count, output: result.output });
  } else {
    console.log(`Exported ${result.count} records to ${result.output}`);
  }
}

async function handleSync(options) {
  const config = loadConfig();
  const { acquireSyncLock, releaseSyncLock } = require("./sync-lock");
  const lock = acquireSyncLock({
    force: !!options.force,
    ttlMs: options["lock-ttl"] ? Number(options["lock-ttl"]) : undefined,
  });

  if (!lock.ok) {
    console.error("Sync already running. Use --force to override.");
    process.exitCode = 1;
    return;
  }

  try {
    const syncOptions = {
      dryRun: !!options["dry-run"],
      since: options.since,
      chunkSize: options["chunk-size"] ? Number(options["chunk-size"]) : undefined,
    };

    const result = await syncToServer(config, syncOptions);

    if (options.json) {
      printJson(result);
    } else {
      console.log(`Synced ${result.uploaded} records in ${result.chunks} request(s)`);
      if (result.duplicates) console.log(`  Duplicates skipped: ${result.duplicates}`);
      if (result.rejected) console.log(`  Rejected: ${result.rejected}`);
    }
  } finally {
    releaseSyncLock(lock.lockPath);
  }
}

function handleSyncStatus(options) {
  const config = loadConfig();
  const status = getSyncStatus(config, options.limit ? Number(options.limit) : 5);
  if (options.json) {
    printJson(status);
    return;
  }
  const checkpoint = status.checkpoint;
  const checkpointText =
    checkpoint && checkpoint.lastSyncedAt
      ? `${checkpoint.lastSyncedAt} (${checkpoint.lastSyncedId || "no-id"})`
      : "none";
  console.log(`Checkpoint: ${checkpointText}`);
  if (status.lastSuccess) {
    console.log(`Last success: ${status.lastSuccess.completed_at || status.lastSuccess.started_at}`);
  }
  if (status.lastFailure) {
    console.log(`Last failure: ${status.lastFailure.completed_at || status.lastFailure.started_at}`);
  }
  if (status.recent && status.recent.length) {
    console.log("Recent syncs:");
    status.recent.forEach((log) => {
      console.log(
        `- ${log.status} at ${log.started_at} (${log.records_uploaded} records, ${log.files_uploaded} files)`
      );
    });
  }
}

async function handleSyncFlush(options) {
  if (options.help) {
    console.log("Usage: omp sync flush [--yes]");
    console.log("");
    console.log("Delete ALL server-side records for your account.");
    console.log("");
    console.log("Options:");
    console.log("  --yes, -y   Skip confirmation prompt");
    console.log("  --json      Output results as JSON");
    return;
  }

  const config = loadConfig();
  const serverUrl = config.server?.url;
  const serverToken = config.server?.token;

  if (!serverUrl || !serverToken) {
    console.error(
      "Server not configured. Set server.url and server.token:\n" +
        "  omp config set server.url https://your-server.example.com\n" +
        "  omp config set server.token YOUR_TOKEN"
    );
    process.exitCode = 1;
    return;
  }

  if (!options.yes && !options.y) {
    console.log("This will delete ALL server-side records for your account.");
    console.log("Run with --yes to confirm.");
    process.exitCode = 1;
    return;
  }

  const flushUrl = `${serverUrl.replace(/\/$/, "")}/api/sync/flush`;
  const headers = { "X-User-Token": serverToken };

  try {
    const response = await postJson(flushUrl, headers, {}, "DELETE");
    if (response.status === 401) {
      throw new Error("Authentication failed. Check server.token.");
    }
    if (response.status >= 400) {
      throw new Error(`Server error (${response.status}): ${JSON.stringify(response.body)}`);
    }

    // Reset local sync state so next sync re-uploads everything
    updateSyncState(config, null, null);

    if (options.json) {
      printJson({ flushed: true, deleted: response.body.deleted || 0 });
    } else {
      console.log(`Server data flushed. ${response.body.deleted || 0} records deleted.`);
      console.log("Local sync state reset. Run 'omp sync' to re-upload.");
    }
  } catch (error) {
    console.error(`Flush failed: ${error.message}`);
    process.exitCode = 1;
  }
}

async function handleIngest(options) {
  const config = loadConfig();
  if (options.replay) {
    const result = replayQueue(config);
    if (options.json) {
      printJson(result);
    } else {
      console.log(`Replayed ${result.processed} records, failed ${result.failed}.`);
    }
    return;
  }

  let rawPayload = options.json ? options.json : null;
  if (options.stdin || !process.stdin.isTTY) {
    rawPayload = await readStdin();
  }

  if (!rawPayload) {
    console.error("No payload provided.");
    process.exitCode = 2;
    return;
  }

  const result = ingestPayload(rawPayload, config);
  if (options.json) {
    printJson(result);
  } else if (!result.ok) {
    console.error(result.error || "Failed to ingest");
    process.exitCode = 1;
  }
}

async function main() {
  const { command, options, positional } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "setup": {
      if (options.help) {
        console.log("Usage: omp setup [OPTIONS]");
        console.log("");
        console.log("Interactive setup wizard for Oh My Prompt.");
        console.log("");
        console.log("Options:");
        console.log("  --server <url>    Server URL (default: https://your-server.example.com)");
        console.log("  --token <token>   Authentication token");
        console.log("  --device <name>   Device name (default: hostname)");
        console.log("  --hooks <targets> Comma-separated: claude,codex,all,none");
        console.log("  --no-hooks        Skip hook installation");
        console.log("  --skip-validate   Skip server token validation");
        console.log("  --yes, -y         Non-interactive mode, accept all defaults");
        console.log("  --dry-run         Show what would be done without making changes");
        console.log("  --json            Output results as JSON");
        break;
      }
      const { runSetup } = require("./setup");
      const setupResult = await runSetup(options);
      if (!setupResult.ok) process.exitCode = 1;
      break;
    }
    case "install": {
      const installed = await handleInstall(options);
      if (options.json) {
        printJson({ installed });
      } else {
        installed.forEach((item) => {
          console.log(`Installed ${item.cli} hook at ${item.path}`);
          if (item.cli === "codex" && item.conflict) {
            console.log(
              "Codex notify is already configured. Please add Oh My Prompt notify manually or replace the existing notify entry."
            );
          }
          if (item.cli === "codex" && item.merged) {
            console.log("Codex notify merged via wrapper.");
          }
          if (item.cli === "codex" && item.configured) {
            console.log(`Codex config updated at ${item.configPath}`);
          }
        });
      }
      break;
    }
    case "uninstall": {
      if (options.help) {
        console.log("Usage: omp uninstall [OPTIONS]");
        console.log("");
        console.log("Remove Oh My Prompt hooks and data.");
        console.log("");
        console.log("Options:");
        console.log("  --cli <targets>    Comma-separated: claude,codex (default: auto-detect)");
        console.log("  --all              Full uninstall: remove hooks, config, and data");
        console.log("  --hooks-only       With --all: only remove hooks, keep config and data");
        console.log("  --remove-config    Remove config file (without --all)");
        console.log("  --yes, -y          Skip confirmation prompts");
        console.log("  --json             Output results as JSON");
        break;
      }
      const removed = await handleUninstall(options);
      if (options.json) {
        printJson({ removed });
      } else if (!options.all) {
        removed.forEach((item) => console.log(`Removed ${item.cli} hook at ${item.path}`));
      }
      break;
    }
    case "status":
      handleStatus(options);
      break;
    case "stats":
      handleStats(options);
      break;
    case "export":
      handleExport(options);
      break;
    case "sync":
      if (positional[0] === "status") {
        handleSyncStatus(options);
      } else if (positional[0] === "flush") {
        await handleSyncFlush(options);
      } else {
        await handleSync(options);
      }
      break;
    case "ingest":
      await handleIngest(options);
      break;
    case "config":
      handleConfig(options, positional);
      break;
    case "import":
      await handleImport(options, positional);
      break;
    case "backfill": {
      if (options.help) {
        console.log("Usage: omp backfill [OPTIONS]");
        console.log("");
        console.log("Scan Claude Code transcripts and ingest all turns into omp.db.");
        console.log("Reads JSONL files from ~/.claude/projects/*/ directories.");
        console.log("");
        console.log("Options:");
        console.log("  --path <file>   Process a single transcript file");
        console.log("  --dry-run       Show what would be imported without writing");
        console.log("  --json          Output results as JSON");
        break;
      }
      const { backfillTranscripts } = require("./backfill");
      const config = loadConfig();
      const result = backfillTranscripts(config, {
        path: options.path,
        dryRun: !!options["dry-run"],
      });
      if (options.json) {
        printJson(result);
      } else {
        console.log(`Scanned ${result.files} transcript file(s)`);
        console.log(`Imported: ${result.totalImported}, Skipped: ${result.totalSkipped}, Duplicates: ${result.totalDuplicates}`);
        for (const f of result.fileResults) {
          const name = path.basename(f.path, ".jsonl");
          const status = f.error ? ` (${f.error})` : "";
          console.log(`  ${name}: ${f.turns} turns, ${f.imported} imported, ${f.duplicates} deduped${status}`);
        }
      }
      break;
    }
    case "db": {
      const action = positional[0];
      if (action === "migrate") {
        const { migrateDatabase } = require("./migrate");
        const config = loadConfig();
        const result = migrateDatabase(config);
        if (options.json) {
          printJson(result);
        } else {
          console.log(`Schema version: ${result.version}`);
        }
        break;
      }
      if (action === "flush") {
        if (options.help) {
          console.log("Usage: omp db flush [--yes]");
          console.log("");
          console.log("Delete ALL local records and reset sync state.");
          console.log("");
          console.log("Options:");
          console.log("  --yes, -y   Skip confirmation prompt");
          console.log("  --json      Output results as JSON");
          break;
        }
        const config = loadConfig();
        if (!options.yes && !options.y) {
          console.log("This will delete ALL local records and reset sync state.");
          console.log("Run with --yes to confirm.");
          process.exitCode = 1;
          break;
        }
        const db = openDb(config.storage.sqlite.path);
        db.exec("DELETE FROM prompts");
        db.exec("DELETE FROM sync_log");
        db.exec("DELETE FROM sync_state");
        try { db.exec("INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild')"); } catch {}
        const remaining = db.prepare("SELECT count(*) as c FROM prompts").get();
        db.close();
        if (options.json) {
          printJson({ flushed: true, remaining: remaining.c });
        } else {
          console.log("Local database flushed. All records and sync state cleared.");
        }
        break;
      }
      console.error("Usage: omp db <migrate|flush>");
      process.exitCode = 2;
      break;
    }
    case "doctor": {
      const { runDoctor } = require("./doctor");
      const config = loadConfig();
      const report = runDoctor(config);
      if (options.json) {
        printJson(report);
      } else {
        if (report.ok) console.log("Doctor: OK");
        if (report.errors.length) {
          console.log("Errors:");
          report.errors.forEach((err) => console.log(`- ${err}`));
        }
        if (report.warnings.length) {
          console.log("Warnings:");
          report.warnings.forEach((warn) => console.log(`- ${warn}`));
        }
      }
      if (!report.ok) process.exitCode = 1;
      break;
    }
    default:
      console.log("Oh My Prompt CLI");
      console.log(
        "Commands: setup, install, uninstall, status, stats, export, sync, ingest, config, import, backfill, db, doctor"
      );
      console.log("Use --help with each command for options.");
      process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
