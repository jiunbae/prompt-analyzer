const http = require("http");
const https = require("https");
const { openDb } = require("./db");
const { createSyncLog, finishSyncLog, getSyncState, updateSyncState, getDeviceId } = require("./sync-log");
const { postprocessUploadRecord } = require("./upload-postprocess");

function fetchRows(db, since, lastId) {
  if (!since) {
    return db
      .prepare("SELECT * FROM prompts ORDER BY created_at ASC, id ASC")
      .all();
  }

  const iso = new Date(since).toISOString();
  // Fetch new rows OR rows updated after last sync (e.g. response added later)
  if (lastId) {
    return db
      .prepare(
        `SELECT * FROM prompts
         WHERE (created_at > ? OR (created_at = ? AND id > ?))
            OR (updated_at > ? AND response_text IS NOT NULL AND created_at <= ?)
         ORDER BY created_at ASC, id ASC`
      )
      .all(iso, iso, lastId, iso, iso);
  }
  return db
    .prepare(
      `SELECT * FROM prompts
       WHERE created_at > ?
          OR (updated_at > ? AND response_text IS NOT NULL AND created_at <= ?)
       ORDER BY created_at ASC, id ASC`
    )
    .all(iso, iso, iso);
}

function rowToUploadRecord(row) {
  return {
    event_id: row.event_id || row.id.toString(),
    created_at: row.created_at,
    prompt_text: row.prompt_text,
    response_text: row.response_text ?? null,
    prompt_length: row.prompt_length ?? (row.prompt_text ? row.prompt_text.length : 0),
    response_length: row.response_length ?? null,
    project: row.project || (row.cwd ? require("path").basename(row.cwd) : null),
    cwd: row.cwd ?? null,
    source: row.source || "omp-cli",
    session_id: row.session_id ?? null,
    role: row.role || "user",
    model: row.model ?? null,
    cli_name: row.cli_name ?? null,
    cli_version: row.cli_version ?? null,
    token_estimate: row.token_estimate ?? null,
    token_estimate_response: row.token_estimate_response ?? null,
    word_count: row.word_count ?? null,
    word_count_response: row.word_count_response ?? null,
    content_hash: row.content_hash ?? null,
  };
}

function postJson(url, headers, body, method = "POST") {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    const payload = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
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
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: json });
        } catch {
          reject(new Error(`Failed to parse JSON response (status: ${res.statusCode}): ${data.slice(0, 200)}`));
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
      let records = chunk.map(rowToUploadRecord);
      records = records.map((r) => postprocessUploadRecord(r, config));
      records = records.filter((r) => r.prompt_text && r.prompt_text.trim().length > 0);

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

      if (response.status >= 400) {
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

    // Only advance sync state if the server actually accepted records
    // This prevents permanently skipping records when the server is temporarily down
    const lastRow = rows[rows.length - 1];
    if (!options.dryRun && lastRow?.created_at && (totalAccepted > 0 || totalDuplicates > 0)) {
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

module.exports = {
  syncToServer,
  postJson,
};
