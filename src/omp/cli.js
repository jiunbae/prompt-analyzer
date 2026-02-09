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
const { getReport, formatReportText } = require("./report");
const { exportData } = require("./export");
const { syncToServer, syncToObjectStore } = require("./sync");
const { getSyncStatus } = require("./sync-log");
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

  if (options.storage) config.storage.type = options.storage;
  if (options["sqlite-path"]) config.storage.sqlite.path = options["sqlite-path"];
  if (options["capture-response"] !== undefined) {
    config.capture.response = parseBoolean(options["capture-response"], true);
  }

  // Legacy S3/MinIO config (deprecated)
  if (options.bucket) {
    config.storage.s3.bucket = options.bucket;
    config.storage.minio.bucket = options.bucket;
  }
  if (options.endpoint) {
    config.storage.s3.endpoint = options.endpoint;
    config.storage.minio.endpoint = options.endpoint;
  }
  if (options["access-key"]) {
    config.storage.s3.accessKey = options["access-key"];
    config.storage.minio.accessKey = options["access-key"];
  }
  if (options["secret-key"]) {
    config.storage.s3.secretKey = options["secret-key"];
    config.storage.minio.secretKey = options["secret-key"];
  }
  if (options.region) {
    config.storage.s3.region = options.region;
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

async function handleUninstall(options) {
  const config = loadConfig();
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
    const configPath = require("./paths").getConfigPath();
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

function handleReport(options) {
  const config = loadConfig();
  const report = getReport(config, { since: options.since, until: options.until });

  if (options.json || options.format === "json") {
    printJson(report);
    return;
  }

  console.log(formatReportText(report));
}

async function handleAnalyze(options, positional) {
  const config = loadConfig();
  let text = "";

  if (options.file) {
    text = fs.readFileSync(path.resolve(options.file), "utf-8");
  } else if (options.stdin || !process.stdin.isTTY) {
    text = await readStdin();
  } else if (positional[0]) {
    const db = openDb(config.storage.sqlite.path);
    const row = db
      .prepare("SELECT prompt_text FROM prompts WHERE id = ?")
      .get(positional[0]);
    db.close();
    text = row ? row.prompt_text : "";
  }

  if (!text) {
    console.error("No prompt text provided.");
    process.exitCode = 2;
    return;
  }

  const { analyzePrompt } = require("./insights");
  const review = analyzePrompt(text);

  if (options.json) {
    printJson(review);
  } else {
    console.log(`Score: ${review.score} (${review.scoreLabel})`);
    console.log("Signals:");
    review.signals.forEach((signal) => {
      console.log(`- ${signal.label}: ${signal.present ? "present" : "missing"}`);
    });
    if (review.suggestions.length) {
      console.log("Suggestions:");
      review.suggestions.forEach((s) => console.log(`- ${s}`));
    }
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

    // Use server sync if configured, otherwise fall back to legacy
    const useServer = config.server?.url && config.server?.token;
    const result = useServer
      ? await syncToServer(config, syncOptions)
      : await syncToObjectStore(config, syncOptions);

    if (options.json) {
      printJson(result);
    } else {
      if (useServer) {
        console.log(`Synced ${result.uploaded} records in ${result.chunks} request(s)`);
        if (result.duplicates) console.log(`  Duplicates skipped: ${result.duplicates}`);
        if (result.rejected) console.log(`  Rejected: ${result.rejected}`);
      } else {
        console.log(`Uploaded ${result.uploaded} records (${result.files} files)`);
        console.log("  Warning: Using legacy direct MinIO sync. Configure server.url and server.token for the new sync method.");
      }
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
      const removed = await handleUninstall(options);
      if (options.json) {
        printJson({ removed });
      } else {
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
    case "report":
      handleReport(options);
      break;
    case "analyze":
      await handleAnalyze(options, positional);
      break;
    case "export":
      handleExport(options);
      break;
    case "sync":
      if (positional[0] === "status") {
        handleSyncStatus(options);
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
      console.error("Usage: omp db migrate");
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
        "Commands: setup, install, uninstall, status, stats, report, analyze, export, sync, ingest, config, import, db, doctor"
      );
      console.log("Use --help with each command for options.");
      process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
