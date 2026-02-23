const fs = require("fs");
const path = require("path");
const { openDb } = require("./db");
const { getQueueStats } = require("./queue");
const { listHookStatus } = require("./hooks");
const { getSyncStatus } = require("./sync-log");

function validateConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config.storage.sqlite?.path) {
    errors.push("storage.sqlite.path is required");
  }

  if (config.queue?.maxBytes !== undefined && Number(config.queue.maxBytes) <= 0) {
    errors.push("queue.maxBytes must be > 0");
  }

  // Server sync config
  if (config.server?.url && config.server?.token) {
    // Server sync configured - good
  } else if (config.server?.url && !config.server?.token) {
    errors.push("server.url is set but server.token is missing");
  } else if (!config.server?.url && config.server?.token) {
    warnings.push("server.token is set but server.url is missing");
  } else {
    warnings.push("No sync configured. Set server.url and server.token for cloud sync.");
  }

  if (!config.server?.deviceId && !config.sync?.deviceId) {
    warnings.push("No deviceId configured (defaults to hostname)");
  }

  // Validate sync timing config
  try {
    const { validateTimingConfig } = require("./auto-sync");
    const timing = validateTimingConfig(config.sync?.debounce, config.sync?.interval);
    errors.push(...timing.errors);
  } catch {
    // auto-sync module not available, skip timing validation
  }

  return { ok: errors.length === 0, errors, warnings };
}

function runDoctor(config) {
  const report = {
    ok: true,
    errors: [],
    warnings: [],
    checks: {},
  };

  const validation = validateConfig(config);
  report.errors.push(...validation.errors);
  report.warnings.push(...validation.warnings);

  // DB check
  try {
    const db = openDb(config.storage.sqlite.path);
    db.close();
    report.checks.db = "ok";
  } catch (error) {
    report.errors.push(`db: ${error.message || "failed to open"}`);
    report.checks.db = "error";
  }

  // Queue stats
  const queueStats = getQueueStats();
  report.checks.queue = queueStats;
  if (queueStats.count > 0) {
    report.warnings.push("queue has pending items; run 'omp ingest --replay'");
  }

  // Hooks
  const hooks = listHookStatus();
  report.checks.hooks = hooks;
  if (config.hooks?.enabled?.claude_code && !hooks.claude_code) {
    report.warnings.push("Claude hook enabled in config but not installed");
  }
  if (config.hooks?.enabled?.codex && !hooks.codex) {
    report.warnings.push("Codex hook enabled in config but not installed");
  }
  if (config.hooks?.enabled?.opencode && !hooks.opencode) {
    report.warnings.push("OpenCode hook enabled in config but not installed");
  }

  // Sync status
  try {
    report.checks.sync = getSyncStatus(config, 1);
  } catch (error) {
    report.warnings.push("sync status unavailable");
  }

  // Auto-sync daemon status
  try {
    const { isDaemonRunning, getLastSyncTime } = require("./auto-sync");
    const daemonState = isDaemonRunning();
    const lastSync = getLastSyncTime();

    report.checks.autoSync = {
      enabled: !!config.sync?.auto,
      running: daemonState.running,
      pid: daemonState.pid,
      lastSyncTime: lastSync,
    };

    if (config.sync?.auto && !daemonState.running) {
      report.warnings.push(
        "Auto-sync is enabled but daemon is not running. Start with: omp sync auto"
      );
    }
  } catch {
    // auto-sync module not available, skip
  }

  report.ok = report.errors.length === 0;
  return report;
}

module.exports = {
  validateConfig,
  runDoctor,
};
