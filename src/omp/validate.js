const http = require("http");
const https = require("https");

/**
 * Validate that the server is reachable and the token is accepted.
 * Sends a lightweight POST to /api/sync/upload with an empty records array.
 *
 * @param {string} serverUrl - e.g. "https://your-server.example.com"
 * @param {string} token - The user's auth token
 * @param {string} deviceId - Device identifier
 * @param {object} [options] - { timeout: 10000 }
 * @returns {Promise<{ valid: boolean, status: number|null, error: string|null }>}
 */
async function validateToken(serverUrl, token, deviceId, options = {}) {
  const timeout = options.timeout || 10000;
  const url = `${serverUrl.replace(/\/$/, "")}/api/sync/upload`;

  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ valid: false, status: null, error: `Invalid URL: ${url}` });
      return;
    }

    const transport = parsed.protocol === "https:" ? https : http;
    const payload = JSON.stringify({ records: [], deviceId: deviceId || "validation" });

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "X-User-Token": token,
      },
      timeout,
    };

    const req = transport.request(reqOptions, (res) => {
      // Consume response body to free the socket
      res.resume();
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ valid: true, status: res.statusCode, error: null });
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          resolve({
            valid: false,
            status: res.statusCode,
            error: "Token rejected by server (unauthorized)",
          });
        } else {
          resolve({
            valid: false,
            status: res.statusCode,
            error: `Server returned status ${res.statusCode}`,
          });
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ valid: false, status: null, error: "Connection timed out" });
    });

    req.on("error", (err) => {
      resolve({
        valid: false,
        status: null,
        error: err.code === "ECONNREFUSED"
          ? "Connection refused"
          : err.code === "ENOTFOUND"
            ? "DNS resolution failed"
            : err.message || "Network error",
      });
    });

    req.write(payload);
    req.end();
  });
}

module.exports = { validateToken };
