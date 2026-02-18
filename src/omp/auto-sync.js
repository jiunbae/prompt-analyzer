const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { getConfigDir, ensureDir } = require("./paths");

const TRIGGER_FILE = path.join(getConfigDir(), "sync-trigger");
const PID_FILE = path.join(getConfigDir(), "sync-daemon.pid");
const LOG_FILE = path.join(getConfigDir(), "sync-daemon.log");

const DEFAULT_DEBOUNCE_S = 30;
const DEFAULT_INTERVAL_S = 300;

// Validation bounds (in seconds)
const MIN_DEBOUNCE_S = 1;    // 1 000 ms
const MIN_INTERVAL_S = 30;   // 30 000 ms
const MAX_DEBOUNCE_S = 3600; // 1 hour
const MAX_INTERVAL_S = 86400; // 24 hours

const SHUTDOWN_TIMEOUT_MS = 15000; // 15 seconds max to drain
const STOP_POLL_INTERVAL_MS = 200; // poll interval when waiting for daemon to stop
const STOP_TIMEOUT_MS = SHUTDOWN_TIMEOUT_MS + 5000; // total wait for stop (drain + margin)

const DAEMON_PROCESS_TITLE = "omp-auto-sync";

function appendLog(message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}\n`;
  try {
    ensureDir(path.dirname(LOG_FILE));
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // ignore log write failures
  }
}

/**
 * Validate sync.debounce and sync.interval values.
 * Returns sanitised seconds or throws on invalid input.
 */
function validateTimingConfig(rawDebounce, rawInterval) {
  const errors = [];

  let debounce = rawDebounce;
  if (debounce === undefined || debounce === null) {
    debounce = DEFAULT_DEBOUNCE_S;
  } else {
    debounce = Number(debounce);
    if (!Number.isFinite(debounce) || debounce < MIN_DEBOUNCE_S) {
      errors.push(
        `sync.debounce must be a finite number >= ${MIN_DEBOUNCE_S} (got ${rawDebounce})`
      );
    } else if (debounce > MAX_DEBOUNCE_S) {
      errors.push(
        `sync.debounce must be <= ${MAX_DEBOUNCE_S} (got ${rawDebounce})`
      );
    }
  }

  let interval = rawInterval;
  if (interval === undefined || interval === null) {
    interval = DEFAULT_INTERVAL_S;
  } else {
    interval = Number(interval);
    if (!Number.isFinite(interval) || interval < MIN_INTERVAL_S) {
      errors.push(
        `sync.interval must be a finite number >= ${MIN_INTERVAL_S} (got ${rawInterval})`
      );
    } else if (interval > MAX_INTERVAL_S) {
      errors.push(
        `sync.interval must be <= ${MAX_INTERVAL_S} (got ${rawInterval})`
      );
    }
  }

  return { debounce, interval, errors };
}

// ---------------------------------------------------------------------------
// PID file helpers — store JSON {pid, startedAt} for identity verification
// ---------------------------------------------------------------------------

function readPidInfo() {
  try {
    if (!fs.existsSync(PID_FILE)) return null;
    const raw = fs.readFileSync(PID_FILE, "utf-8").trim();

    // Try JSON format first (new format)
    try {
      const info = JSON.parse(raw);
      if (info && typeof info.pid === "number") {
        return info;
      }
    } catch {
      // Fall back to plain-number format for backward compat
    }

    const pid = parseInt(raw, 10);
    return Number.isNaN(pid) ? null : { pid, startedAt: null };
  } catch {
    return null;
  }
}

function writePidInfo(pid) {
  const info = {
    pid,
    startedAt: Date.now(),
    command: DAEMON_PROCESS_TITLE,
  };
  ensureDir(path.dirname(PID_FILE));
  fs.writeFileSync(PID_FILE, JSON.stringify(info), { mode: 0o600 });
}

function removePid() {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the command line of a running process by PID.
 * On Linux reads /proc/{pid}/cmdline; on macOS uses `ps`.
 * Returns the command string, or null if it cannot be determined.
 */
function getProcessCommand(pid) {
  try {
    // Try /proc first (Linux)
    const cmdlinePath = `/proc/${pid}/cmdline`;
    if (fs.existsSync(cmdlinePath)) {
      const raw = fs.readFileSync(cmdlinePath, "utf-8");
      // /proc/pid/cmdline uses NUL separators
      return raw.replace(/\0/g, " ").trim();
    }
  } catch {
    // /proc not available or not readable — fall through to ps
  }

  try {
    // macOS / BSD fallback
    const output = execSync(`ps -p ${pid} -o command=`, {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim();
  } catch {
    return null;
  }
}

/**
 * Verify that the PID recorded in the PID file actually belongs to our daemon
 * by checking liveness and confirming the running process command matches the
 * expected daemon process title ("omp-auto-sync").
 *
 * On startup the daemon sets process.title = DAEMON_PROCESS_TITLE, and the PID
 * file stores the expected command string. Verification reads the actual
 * process command via /proc/{pid}/cmdline (Linux) or `ps` (macOS) and checks
 * that it contains the expected title.
 */
function verifyDaemonIdentity(pidInfo) {
  if (!pidInfo || !pidInfo.pid) return false;
  if (!isProcessAlive(pidInfo.pid)) return false;

  // Determine expected command string from pidfile, fall back to the constant
  const expectedCommand = pidInfo.command || DAEMON_PROCESS_TITLE;

  const actualCommand = getProcessCommand(pidInfo.pid);
  if (!actualCommand) {
    // Cannot determine process command — fall back to timestamp plausibility
    // so we don't break on platforms where ps is unavailable
    if (pidInfo.startedAt) {
      const age = Date.now() - pidInfo.startedAt;
      return age >= 0 && age < 365 * 24 * 60 * 60 * 1000;
    }
    return false;
  }

  // Check if the actual command contains our daemon process title
  return actualCommand.includes(expectedCommand);
}

function isDaemonRunning() {
  const pidInfo = readPidInfo();
  if (!pidInfo) return { running: false, pid: null };
  if (verifyDaemonIdentity(pidInfo)) return { running: true, pid: pidInfo.pid };
  // Stale PID file - clean up
  removePid();
  return { running: false, pid: null };
}

function getLastSyncTime() {
  try {
    if (!fs.existsSync(LOG_FILE)) return null;
    const content = fs.readFileSync(LOG_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    // Walk backward to find the last sync result line
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.includes("sync completed") || line.includes("sync failed")) {
        const match = line.match(/^\[([^\]]+)\]/);
        return match ? match[1] : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function touchTrigger() {
  try {
    ensureDir(path.dirname(TRIGGER_FILE));
    fs.writeFileSync(TRIGGER_FILE, Date.now().toString());
  } catch {
    // ignore trigger write failures
  }
}

/**
 * Run the daemon loop in the current process.
 * This is called by the detached child process.
 */
function runDaemonLoop(configPath) {
  const { loadConfig } = require("./config");
  const { syncToServer } = require("./sync");
  const { acquireSyncLock, releaseSyncLock } = require("./sync-lock");

  // Set process title for identity verification via ps / /proc
  process.title = DAEMON_PROCESS_TITLE;

  // Override config path if provided
  if (configPath) {
    process.env.OMP_CONFIG_PATH = configPath;
  }

  const config = loadConfig();

  // Validate timing config
  const timing = validateTimingConfig(config.sync?.debounce, config.sync?.interval);
  if (timing.errors.length > 0) {
    for (const err of timing.errors) {
      appendLog("config error: " + err);
    }
    appendLog("daemon refusing to start due to invalid config");
    process.exitCode = 1;
    return;
  }

  const debounceMs = timing.debounce * 1000;
  const intervalMs = timing.interval * 1000;

  writePidInfo(process.pid);
  appendLog("daemon started (pid=" + process.pid + ", debounce=" + (debounceMs / 1000) + "s, interval=" + (intervalMs / 1000) + "s)");

  let debounceTimer = null;
  let intervalTimer = null;
  let syncing = false;
  let pendingSync = false;
  let shuttingDown = false;
  let lastTriggerMtime = 0;
  let activeLockPath = null;

  async function doSync() {
    if (shuttingDown) return;
    if (syncing) {
      // Mark pending so we run again after current sync finishes
      pendingSync = true;
      return;
    }
    syncing = true;
    pendingSync = false;

    // Reload config each time in case it changed
    let currentConfig;
    try {
      currentConfig = loadConfig();
    } catch {
      currentConfig = config;
    }

    const lock = acquireSyncLock({ ttlMs: 60000 });
    if (!lock.ok) {
      appendLog("sync skipped: lock held by another process");
      syncing = false;
      // If something was pending, try again after a short delay
      if (pendingSync && !shuttingDown) {
        pendingSync = false;
        setTimeout(() => doSync(), 5000);
      }
      return;
    }

    activeLockPath = lock.lockPath;

    try {
      const result = await syncToServer(currentConfig);
      appendLog(
        "sync completed: uploaded=" + result.uploaded +
        " duplicates=" + (result.duplicates || 0) +
        " chunks=" + result.chunks
      );
    } catch (err) {
      appendLog("sync failed: " + (err.message || "unknown error"));
    } finally {
      releaseSyncLock(lock.lockPath);
      activeLockPath = null;
      syncing = false;

      // If a sync was requested while we were busy, run it now
      if (pendingSync && !shuttingDown) {
        pendingSync = false;
        doSync();
      }
    }
  }

  function scheduleDebounce() {
    if (shuttingDown) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      doSync();
    }, debounceMs);
  }

  // Poll the trigger file for changes
  const pollInterval = setInterval(() => {
    if (shuttingDown) return;
    try {
      if (!fs.existsSync(TRIGGER_FILE)) return;
      const stat = fs.statSync(TRIGGER_FILE);
      const mtime = stat.mtimeMs;
      if (mtime > lastTriggerMtime) {
        lastTriggerMtime = mtime;
        scheduleDebounce();
      }
    } catch {
      // ignore poll errors
    }
  }, 2000);

  // Max interval timer: sync at least every `interval` seconds
  intervalTimer = setInterval(() => {
    if (!syncing && !shuttingDown) {
      appendLog("interval sync triggered");
      doSync();
    }
  }, intervalMs);

  // Graceful shutdown: drain active sync, release lock, then exit
  let shutdownInProgress = false;
  function shutdown(signal) {
    if (shutdownInProgress) return; // prevent double-shutdown
    shutdownInProgress = true;
    shuttingDown = true;

    appendLog("daemon stopping (" + signal + ") — draining...");

    // Stop accepting new work
    if (debounceTimer) clearTimeout(debounceTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    clearInterval(pollInterval);
    pendingSync = false;

    if (!syncing) {
      // No active sync — exit immediately
      removePid();
      appendLog("daemon stopped (clean)");
      process.exit(0);
      return;
    }

    // Active sync in progress — wait for it to finish (with timeout)
    const drainStart = Date.now();
    const drainCheck = setInterval(() => {
      if (!syncing) {
        clearInterval(drainCheck);
        removePid();
        appendLog("daemon stopped (drained)");
        process.exit(0);
        return;
      }
      if (Date.now() - drainStart > SHUTDOWN_TIMEOUT_MS) {
        clearInterval(drainCheck);
        appendLog("daemon shutdown timeout — forcing exit");
        // Best-effort lock release
        if (activeLockPath) {
          try {
            const { releaseSyncLock: release } = require("./sync-lock");
            release(activeLockPath, { force: true });
          } catch {
            // ignore
          }
        }
        removePid();
        process.exit(1);
      }
    }, 250);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Keep the event loop alive
  process.stdin.resume();
}

function startDaemon(config) {
  const status = isDaemonRunning();
  if (status.running) {
    return { started: false, alreadyRunning: true, pid: status.pid };
  }

  // Validate timing config before starting
  const timing = validateTimingConfig(config.sync?.debounce, config.sync?.interval);
  if (timing.errors.length > 0) {
    return { started: false, alreadyRunning: false, errors: timing.errors };
  }

  const { getConfigPath } = require("./paths");
  const configPath = getConfigPath();

  // Fork a detached child that runs the daemon loop
  const { fork } = require("child_process");

  // Write the daemon entry script into the config dir (not source dir)
  const daemonScript = path.join(getConfigDir(), "auto-sync-daemon.js");
  ensureDir(path.dirname(daemonScript));

  // The daemon script needs to resolve the auto-sync module from the
  // installed package location. We embed the resolved path so it works
  // regardless of where the config dir is.
  const autoSyncPath = require.resolve("./auto-sync");
  fs.writeFileSync(
    daemonScript,
    'require(' + JSON.stringify(autoSyncPath) + ').runDaemonLoop(process.argv[2]);\n'
  );

  const child = fork(daemonScript, [configPath], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  // Give the child a moment to write its PID
  // We return the child PID immediately since the daemon writes it on startup
  return { started: true, alreadyRunning: false, pid: child.pid };
}

/**
 * Stop the daemon by sending SIGTERM and waiting for it to drain and remove
 * its own PID file. Polls until the pidfile disappears or the process exits,
 * with a timeout. The daemon's shutdown handler is responsible for removing
 * the pidfile after drain completes, so status remains "running" until drain
 * is finished.
 */
function stopDaemon() {
  const pidInfo = readPidInfo();
  if (!pidInfo || !verifyDaemonIdentity(pidInfo)) {
    removePid(); // clean up stale file if any
    return { stopped: false, wasRunning: false };
  }

  try {
    process.kill(pidInfo.pid, "SIGTERM");
  } catch {
    // process may have already exited
    removePid();
    return { stopped: true, wasRunning: true, pid: pidInfo.pid };
  }

  // Poll for the daemon to finish draining and remove its own pidfile
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // Check if pidfile is gone (daemon removed it after drain)
    if (!fs.existsSync(PID_FILE)) {
      return { stopped: true, wasRunning: true, pid: pidInfo.pid };
    }
    // Check if process exited (but pidfile might linger on crash)
    if (!isProcessAlive(pidInfo.pid)) {
      removePid(); // clean up orphaned pidfile
      return { stopped: true, wasRunning: true, pid: pidInfo.pid };
    }
    // Synchronous sleep — acceptable in a CLI stop command
    try {
      execSync(`sleep ${STOP_POLL_INTERVAL_MS / 1000}`, { stdio: "ignore" });
    } catch {
      // ignore
    }
  }

  // Timeout — force kill and clean up
  try {
    process.kill(pidInfo.pid, "SIGKILL");
  } catch {
    // already dead
  }
  removePid();
  return { stopped: true, wasRunning: true, pid: pidInfo.pid, timedOut: true };
}

function daemonStatus() {
  const status = isDaemonRunning();
  const lastSync = getLastSyncTime();
  return {
    running: status.running,
    pid: status.pid,
    lastSyncTime: lastSync,
    pidFile: PID_FILE,
    logFile: LOG_FILE,
    triggerFile: TRIGGER_FILE,
  };
}

module.exports = {
  startDaemon,
  stopDaemon,
  daemonStatus,
  isDaemonRunning,
  getLastSyncTime,
  touchTrigger,
  runDaemonLoop,
  validateTimingConfig,
  TRIGGER_FILE,
  PID_FILE,
  LOG_FILE,
};
