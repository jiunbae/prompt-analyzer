const fs = require("fs");
const path = require("path");
const { openDb } = require("./db");
const { getQueueStats } = require("./queue");
const { listHookStatus } = require("./hooks");
const { getSyncStatus } = require("./sync-log");

function validateConfig(config) {
  const errors = [];
  const warnings = [];

  const type = config.storage.type;
  if (!type || !["sqlite", "minio", "s3"].includes(type)) {
    errors.push("storage.type must be sqlite|minio|s3");
  }

  if (!config.storage.sqlite?.path) {
    errors.push("storage.sqlite.path is required");
  }

  if (type === "minio") {
    const minio = config.storage.minio || {};
    if (!minio.bucket) errors.push("storage.minio.bucket is required");
    if (!minio.endpoint) errors.push("storage.minio.endpoint is required");
    if (!minio.accessKey) errors.push("storage.minio.accessKey is required");
    if (!minio.secretKey) errors.push("storage.minio.secretKey is required");
  }

  if (type === "s3") {
    const s3 = config.storage.s3 || {};
    if (!s3.bucket) errors.push("storage.s3.bucket is required");
    if (!s3.accessKey) errors.push("storage.s3.accessKey is required");
    if (!s3.secretKey) errors.push("storage.s3.secretKey is required");
  }

  if (config.queue?.maxBytes !== undefined && Number(config.queue.maxBytes) <= 0) {
    errors.push("queue.maxBytes must be > 0");
  }

  // Server sync config (preferred)
  if (config.server?.url && config.server?.token) {
    // Server sync configured - good
  } else if (config.server?.url && !config.server?.token) {
    errors.push("server.url is set but server.token is missing");
  } else if (!config.server?.url && config.server?.token) {
    warnings.push("server.token is set but server.url is missing");
  } else if (config.sync?.userToken && (config.storage?.minio?.bucket || config.storage?.s3?.bucket)) {
    warnings.push("Using legacy direct MinIO/S3 sync. Migrate to server sync: omp config set server.url <URL>");
  } else {
    warnings.push("No sync configured. Set server.url and server.token for cloud sync.");
  }

  if (!config.server?.deviceId && !config.sync?.deviceId) {
    warnings.push("No deviceId configured (defaults to hostname)");
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

  // Sync status
  try {
    report.checks.sync = getSyncStatus(config, 1);
  } catch (error) {
    report.warnings.push("sync status unavailable");
  }

  report.ok = report.errors.length === 0;
  return report;
}

module.exports = {
  validateConfig,
  runDoctor,
};
