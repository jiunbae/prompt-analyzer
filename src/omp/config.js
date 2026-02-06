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
      type: "sqlite",
      sqlite: {
        path: getDefaultSqlitePath(),
      },
      s3: {
        bucket: "",
        region: "",
        endpoint: "",
        accessKey: "",
        secretKey: "",
        useSSL: true,
      },
      minio: {
        bucket: "",
        endpoint: "",
        accessKey: "",
        secretKey: "",
        useSSL: true,
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
  if (process.env.OMP_STORAGE_TYPE) {
    config.storage.type = process.env.OMP_STORAGE_TYPE;
  }
  if (process.env.OMP_SQLITE_PATH) {
    config.storage.sqlite.path = process.env.OMP_SQLITE_PATH;
  }
  if (process.env.OMP_CAPTURE_RESPONSE) {
    config.capture.response = process.env.OMP_CAPTURE_RESPONSE === "true";
  }

  if (process.env.OMP_S3_BUCKET) config.storage.s3.bucket = process.env.OMP_S3_BUCKET;
  if (process.env.OMP_S3_REGION) config.storage.s3.region = process.env.OMP_S3_REGION;
  if (process.env.OMP_S3_ENDPOINT) config.storage.s3.endpoint = process.env.OMP_S3_ENDPOINT;
  if (process.env.OMP_S3_ACCESS_KEY) config.storage.s3.accessKey = process.env.OMP_S3_ACCESS_KEY;
  if (process.env.OMP_S3_SECRET_KEY) config.storage.s3.secretKey = process.env.OMP_S3_SECRET_KEY;

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
  const parsed = JSON.parse(raw);
  const merged = { ...defaultConfig(), ...parsed };

  merged.server = { ...defaultConfig().server, ...parsed.server };
  merged.storage = { ...defaultConfig().storage, ...parsed.storage };
  merged.storage.sqlite = { ...defaultConfig().storage.sqlite, ...parsed.storage?.sqlite };
  merged.storage.s3 = { ...defaultConfig().storage.s3, ...parsed.storage?.s3 };
  merged.storage.minio = { ...defaultConfig().storage.minio, ...parsed.storage?.minio };
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
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function getConfigSummary(config) {
  return {
    serverUrl: config.server.url,
    serverToken: config.server.token ? config.server.token.slice(0, 8) + "..." : "(not set)",
    storageType: config.storage.type,
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
