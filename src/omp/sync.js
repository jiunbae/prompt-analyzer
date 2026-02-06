const http = require("http");
const https = require("https");
const { openDb, nowIso } = require("./db");
const { createSyncLog, finishSyncLog, getSyncState, updateSyncState, getDeviceId, getUserToken } = require("./sync-log");

function fetchRows(db, since, lastId) {
  const params = [];
  let whereClause = "";
  if (since) {
    if (lastId) {
      whereClause = "WHERE created_at > ? OR (created_at = ? AND id > ?)";
      const iso = new Date(since).toISOString();
      params.push(iso, iso, lastId);
    } else {
      whereClause = "WHERE created_at > ?";
      params.push(new Date(since).toISOString());
    }
  }
  return db
    .prepare(`SELECT * FROM prompts ${whereClause} ORDER BY created_at ASC, id ASC`)
    .all(...params);
}

function rowToUploadRecord(row) {
  return {
    event_id: row.event_id || row.id.toString(),
    created_at: row.created_at,
    prompt_text: row.prompt_text,
    response_text: row.response_text || null,
    prompt_length: row.prompt_length || (row.prompt_text ? row.prompt_text.length : 0),
    response_length: row.response_length || null,
    project: row.project || null,
    cwd: row.cwd || null,
    source: row.source || "omp-cli",
    session_id: row.session_id || null,
    role: row.role || "user",
    model: row.model || null,
    cli_name: row.cli_name || null,
    cli_version: row.cli_version || null,
    token_estimate: row.token_estimate || null,
    token_estimate_response: row.token_estimate_response || null,
    word_count: row.word_count || null,
    word_count_response: row.word_count_response || null,
    content_hash: row.content_hash || null,
  };
}

function postJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    const payload = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...headers,
      },
      timeout: 30000,
    };

    const req = transport.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, body: json });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function syncToServer(config, options = {}) {
  const serverUrl = config.server?.url;
  const serverToken = config.server?.token;

  if (!serverUrl || !serverToken) {
    throw new Error(
      "Server not configured. Set server.url and server.token:\n" +
      "  omp config set server.url https://prompt.jiun.dev\n" +
      "  omp config set server.token YOUR_TOKEN"
    );
  }

  const db = openDb(config.storage.sqlite.path);
  const state = getSyncState(config);
  const since = options.since || state.lastSyncedAt || null;
  const rows = fetchRows(db, since, state.lastSyncedId);
  db.close();

  if (rows.length === 0) {
    return { uploaded: 0, chunks: 0, duplicates: 0, since };
  }

  const chunkSize = options.chunkSize || 500;
  let totalAccepted = 0;
  let totalDuplicates = 0;
  let totalRejected = 0;
  let chunks = 0;
  const errors = [];

  const logId = createSyncLog(config, since, "server");
  const uploadUrl = `${serverUrl.replace(/\/$/, "")}/api/sync/upload`;
  const headers = { "X-User-Token": serverToken };

  try {
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const records = chunk.map(rowToUploadRecord);

      if (options.dryRun) {
        totalAccepted += chunk.length;
        chunks++;
        continue;
      }

      const response = await postJson(uploadUrl, headers, {
        records,
        deviceId: getDeviceId(config),
      });

      if (response.status === 401) {
        throw new Error("Authentication failed. Check server.token.");
      }

      if (response.status === 413) {
        throw new Error("Request too large. Try reducing chunk size.");
      }

      if (response.status >= 500) {
        throw new Error(`Server error (${response.status}): ${JSON.stringify(response.body)}`);
      }

      const result = response.body;
      totalAccepted += result.accepted || 0;
      totalDuplicates += result.duplicates || 0;
      totalRejected += result.rejected || 0;
      if (result.errors?.length) {
        errors.push(...result.errors);
      }
      chunks++;
    }

    const lastRow = rows[rows.length - 1];
    if (!options.dryRun && lastRow?.created_at) {
      updateSyncState(config, lastRow.created_at, lastRow.id);
    }

    finishSyncLog(config, logId, "success", null, chunks, totalAccepted);
    return {
      uploaded: totalAccepted,
      duplicates: totalDuplicates,
      rejected: totalRejected,
      chunks,
      since,
      errors: errors.slice(0, 10),
    };
  } catch (error) {
    finishSyncLog(config, logId, "failed", error.message || "sync failed", chunks, totalAccepted);
    throw error;
  }
}

// Legacy: keep for backward compat if someone still has minio config
async function syncToObjectStore(config, options = {}) {
  // If server is configured, use the new HTTP path
  if (config.server?.url && config.server?.token) {
    return syncToServer(config, options);
  }

  // Legacy MinIO direct sync (deprecated)
  let resolvedType = config.storage.type;
  if (resolvedType === "sqlite") {
    if (config.storage.minio?.bucket) {
      resolvedType = "minio";
    } else if (config.storage.s3?.bucket) {
      resolvedType = "s3";
    }
  }

  if (resolvedType !== "minio" && resolvedType !== "s3") {
    throw new Error(
      "No sync target configured.\n" +
      "Set up server sync:\n" +
      "  omp config set server.url https://prompt.jiun.dev\n" +
      "  omp config set server.token YOUR_TOKEN"
    );
  }

  // Lazy-load minio only for legacy path
  const { Client } = require("minio");
  const zlib = require("zlib");

  const storage = resolvedType === "minio" ? config.storage.minio : config.storage.s3;
  const endpoint = storage.endpoint || (resolvedType === "s3" ? "s3.amazonaws.com" : "");
  if (!storage.bucket || !storage.accessKey || !storage.secretKey || !endpoint) {
    throw new Error("Missing S3/MinIO configuration");
  }

  const client = new Client({
    endPoint: endpoint,
    port: storage.port || (storage.useSSL ? 443 : 80),
    useSSL: storage.useSSL !== false,
    accessKey: storage.accessKey,
    secretKey: storage.secretKey,
    region: storage.region || undefined,
  });
  const bucket = storage.bucket;

  const db = openDb(config.storage.sqlite.path);
  const state = getSyncState(config);
  const since = options.since || state.lastSyncedAt || null;
  const rows = fetchRows(db, since, state.lastSyncedId);
  db.close();

  if (rows.length === 0) {
    return { uploaded: 0, files: 0, since };
  }

  const chunkSize = options.chunkSize || 500;
  let uploaded = 0;
  let files = 0;

  const userToken = getUserToken(config);
  const deviceId = getDeviceId(config);
  const logId = createSyncLog(config, since, resolvedType);

  try {
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const jsonl = chunk.map((row) => JSON.stringify(row)).join("\n") + "\n";
      const gzip = zlib.gzipSync(jsonl);

      const date = new Date(chunk[0].created_at || nowIso());
      const yyyy = date.getUTCFullYear();
      const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(date.getUTCDate()).padStart(2, "0");
      const hh = String(date.getUTCHours()).padStart(2, "0");
      const min = String(date.getUTCMinutes()).padStart(2, "0");
      const key = `${userToken}/${yyyy}/${mm}/${dd}/${hh}${min}-${deviceId}.jsonl.gz`;

      if (!options.dryRun) {
        await client.putObject(bucket, key, gzip, gzip.length, {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
        });
        files += 1;
      }

      uploaded += chunk.length;
    }

    const lastRow = rows[rows.length - 1];
    if (!options.dryRun && lastRow?.created_at) {
      updateSyncState(config, lastRow.created_at, lastRow.id);
    }

    finishSyncLog(config, logId, "success", null, files, uploaded);
    return { uploaded, files, since };
  } catch (error) {
    finishSyncLog(config, logId, "failed", error.message || "sync failed", files, uploaded);
    throw error;
  }
}

module.exports = {
  syncToServer,
  syncToObjectStore,
};
