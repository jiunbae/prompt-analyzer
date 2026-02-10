const fs = require("fs");
const path = require("path");
const {
  getConfigPath,
  ensureDir,
  getConfigDir,
  getDefaultSqlitePath,
} = require("./paths");

function defaultConfig() {
  return {
    server: {
      url: "",
      token: "",
      deviceId: "",
    },
    storage: {
      sqlite: {
        path: getDefaultSqlitePath(),
      },
    },
    capture: {
      response: true,
      redact: {
        enabled: true,
        mask: "[REDACTED]",
      },
    },
    hooks: {
      enabled: {
        claude_code: false,
        codex: false,
        gemini: false,
        opencode: false,
      },
    },
    sync: {
      enabled: false,
      userToken: "",
      deviceId: "",
    },
    queue: {
      maxBytes: 209715200,
    },
  };
}

function applyEnvOverrides(config) {
  if (process.env.OMP_SQLITE_PATH) {
    config.storage.sqlite.path = process.env.OMP_SQLITE_PATH;
  }
  if (process.env.OMP_CAPTURE_RESPONSE) {
    config.capture.response = process.env.OMP_CAPTURE_RESPONSE === "true";
  }

  // Server config overrides
  if (process.env.OMP_SERVER_URL) config.server.url = process.env.OMP_SERVER_URL;
  if (process.env.OMP_SERVER_TOKEN) config.server.token = process.env.OMP_SERVER_TOKEN;

  return config;
}

function loadConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    const config = defaultConfig();
    return applyEnvOverrides(config);
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`Error parsing config file: ${configPath}. Falling back to defaults.`);
    parsed = {};
  }
  const merged = { ...defaultConfig(), ...parsed };

  merged.server = { ...defaultConfig().server, ...parsed.server };
  merged.storage = { ...defaultConfig().storage, ...parsed.storage };
  merged.storage.sqlite = { ...defaultConfig().storage.sqlite, ...parsed.storage?.sqlite };
  merged.capture = { ...defaultConfig().capture, ...parsed.capture };
  if (parsed.capture?.redact) {
    merged.capture.redact = {
      ...defaultConfig().capture.redact,
      ...parsed.capture.redact,
    };
  }
  merged.hooks = { ...defaultConfig().hooks, ...parsed.hooks };
  merged.hooks.enabled = { ...defaultConfig().hooks.enabled, ...parsed.hooks?.enabled };
  merged.sync = { ...defaultConfig().sync, ...parsed.sync };
  merged.queue = { ...defaultConfig().queue, ...parsed.queue };

  // Migrate legacy config: copy sync.userToken to server.token if server not configured
  if (!merged.server.token && merged.sync.userToken) {
    merged.server.token = merged.sync.userToken;
  }

  return applyEnvOverrides(merged);
}

function saveConfig(config) {
  const configPath = getConfigPath();
  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function getConfigSummary(config) {
  return {
    serverUrl: config.server.url,
    serverToken: config.server.token ? config.server.token.slice(0, 8) + "..." : "(not set)",
    storageType: "sqlite",
    sqlitePath: config.storage.sqlite.path,
    captureResponse: config.capture.response,
    hooks: config.hooks.enabled,
  };
}

module.exports = {
  loadConfig,
  saveConfig,
  defaultConfig,
  getConfigSummary,
};
