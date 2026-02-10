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
});
