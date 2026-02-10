const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { ingestPayload } = require("../ingest");
const { syncToServer } = require("../sync");
const { getSyncState } = require("../sync-log");

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-test-"));
  process.env.XDG_CONFIG_HOME = root;
  return root;
}

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

describe("syncToServer", () => {
  it("updates checkpoint after sync", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    const { server, port } = await startMockServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          accepted: parsed.records.length,
          duplicates: 0,
          rejected: 0,
          errors: [],
        }));
      });
    });

    try {
      const config = {
        server: {
          url: `http://127.0.0.1:${port}`,
          token: "test-token",
        },
        storage: {
          sqlite: { path: dbPath },
        },
        capture: { response: true },
        sync: { enabled: true, deviceId: "d1", checkpoint: "" },
        queue: { maxBytes: 1024 * 1024 },
      };

      const payload = JSON.stringify({
        timestamp: new Date().toISOString(),
        source: "test",
        session_id: "s1",
        role: "user",
        text: "Hello sync",
        cli_name: "test",
      });

      ingestPayload(payload, config);
      await syncToServer(config, { dryRun: false });

      const checkpoint = getSyncState(config);
      expect(checkpoint.lastSyncedAt).not.toBeNull();
    } finally {
      server.close();
    }
  });

  it("throws when server is not configured", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    const config = {
      server: { url: "", token: "" },
      storage: {
        sqlite: { path: dbPath },
      },
      capture: { response: true },
      sync: { enabled: true, deviceId: "d1" },
      queue: { maxBytes: 1024 * 1024 },
    };

    await expect(syncToServer(config)).rejects.toThrow("Server not configured");
  });

  it("redacts secrets only on upload (keeps local DB raw)", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    const received = [];
    const { server, port } = await startMockServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        received.push(JSON.parse(body));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          errors: [],
        }));
      });
    });

    try {
      const config = {
        server: {
          url: `http://127.0.0.1:${port}`,
          token: "test-token",
        },
        storage: {
          sqlite: { path: dbPath },
        },
        // No local redaction: keep raw prompts in SQLite.
        capture: {
          response: true,
          redact: { enabled: false, mask: "[REDACTED]" },
        },
        // Upload redaction: sanitize only when syncing to server.
        sync: {
          enabled: true,
          deviceId: "d1",
          redact: { enabled: true, mask: "[REDACTED]" },
        },
        queue: { maxBytes: 1024 * 1024 },
      };

      const secret = "sk-123456789012345678901234567890";
      const payload = JSON.stringify({
        timestamp: new Date().toISOString(),
        source: "test",
        session_id: "s1",
        role: "user",
        text: `Authorization: Bearer ${secret}`,
        cli_name: "test",
      });

      ingestPayload(payload, config);

      const db = require("../db").openDb(dbPath);
      const row = db.prepare("SELECT prompt_text FROM prompts LIMIT 1").get();
      db.close();
      expect(row.prompt_text).toContain(secret);

      await syncToServer(config, { dryRun: false });

      expect(received.length).toBe(1);
      expect(received[0].records.length).toBe(1);
      const uploadedText = received[0].records[0].prompt_text;
      expect(uploadedText).toContain("Authorization: Bearer");
      expect(uploadedText).toContain("[REDACTED]");
      expect(uploadedText).not.toContain(secret);
      expect(uploadedText).not.toContain("sk-");
    } finally {
      server.close();
    }
  });
});
