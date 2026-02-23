const os = require("os");
const fs = require("fs");
const readline = require("readline");
const { loadConfig, saveConfig } = require("./config");
const { validateToken } = require("./validate");

// --- Readline prompt helpers ---

function createPrompter(input, output) {
  const rl = readline.createInterface({ input, output, terminal: false });

  function ask(question, defaultValue) {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    return new Promise((resolve) => {
      output.write(`  > ${question}${suffix}: `);
      rl.once("line", (answer) => {
        const trimmed = answer.trim();
        resolve(trimmed || defaultValue || "");
      });
    });
  }

  function askMasked(question, defaultHint) {
    const suffix = defaultHint ? " [press Enter to keep existing]" : "";
    return new Promise((resolve) => {
      output.write(`  > ${question}${suffix}: `);

      // If stdin supports raw mode, mask character by character
      if (input.isTTY && typeof input.setRawMode === "function") {
        input.setRawMode(true);
        input.resume();

        let value = "";
        const onData = (key) => {
          const char = key.toString("utf-8");

          // Ctrl-C
          if (char === "\u0003") {
            input.setRawMode(false);
            input.removeListener("data", onData);
            output.write("\n");
            process.exit(130);
          }

          // Enter
          if (char === "\r" || char === "\n") {
            input.setRawMode(false);
            input.removeListener("data", onData);
            output.write("\n");
            resolve(value);
            return;
          }

          // Backspace / Delete
          if (char === "\u007F" || char === "\b") {
            if (value.length > 0) {
              value = value.slice(0, -1);
              output.write("\b \b");
            }
            return;
          }

          // Regular character
          value += char;
          output.write("*");
        };

        input.on("data", onData);
      } else {
        // Fallback: no masking (piped input)
        rl.once("line", (answer) => {
          resolve(answer.trim());
        });
      }
    });
  }

  function confirm(question, defaultYes) {
    const hint = defaultYes ? "Y/n" : "y/N";
    return new Promise((resolve) => {
      output.write(`  > ${question} [${hint}]: `);
      rl.once("line", (answer) => {
        const trimmed = answer.trim().toLowerCase();
        if (!trimmed) {
          resolve(defaultYes);
          return;
        }
        resolve(trimmed === "y" || trimmed === "yes");
      });
    });
  }

  function close() {
    rl.close();
  }

  return { ask, askMasked, confirm, close };
}

// --- Utility helpers ---

function isInteractive(options) {
  if (options.yes || options.y) return false;
  if (!process.stdin.isTTY) return false;
  if (process.env.CI) return false;
  return true;
}

function commandExists(cmd) {
  const { spawnSync } = require("child_process");
  const result = spawnSync("which", [cmd], { stdio: "ignore" });
  return result.status === 0;
}

function detectClis() {
  const targets = [];
  const home = os.homedir();
  const path = require("path");
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  if (commandExists("claude") || fs.existsSync(path.join(home, ".claude"))) {
    targets.push("claude");
  }
  if (commandExists("codex") || fs.existsSync(path.join(home, ".codex"))) {
    targets.push("codex");
  }
  if (commandExists("opencode") || fs.existsSync(path.join(xdgConfigHome, "opencode"))) {
    targets.push("opencode");
  }
  return targets;
}

function resolveCliTargets(options) {
  if (options["no-hooks"]) return [];
  if (options.hooks) {
    if (options.hooks === "none") return [];
    if (options.hooks === "all") return ["claude", "codex", "opencode"];
    return options.hooks.split(",").map((s) => s.trim());
  }
  return detectClis();
}

function printBanner(output) {
  output.write("\n");
  output.write("  Oh My Prompt - Setup Wizard\n");
  output.write("  ============================\n\n");
}

function printStep(output, step, total, title) {
  output.write(`  [${step}/${total}] ${title}\n`);
}

function printResult(output, prefix, message) {
  output.write(`    ${prefix} ${message}\n`);
}

function normalizeUrl(url) {
  if (!url) return url;
  url = url.trim();
  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  return url.replace(/\/$/, "");
}

async function cliLogin(serverUrl, email, password, autoRegister = false, name = undefined) {
  const url = `${serverUrl}/api/auth/cli-login`;
  const body = JSON.stringify({ email, password, autoRegister, name });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const data = await res.json();

  if (res.ok && data.success) {
    return { ok: true, token: data.token, registered: !!data.registered, user: data.user };
  }

  return {
    ok: false,
    status: res.status,
    code: data.code || null,
    error: data.error || "Authentication failed",
  };
}

// --- Main wizard ---

async function runSetup(options) {
  const interactive = isInteractive(options);
  const output = process.stdout;
  const totalSteps = 4;

  const result = {
    ok: true,
    config: {},
    db: {},
    hooks: {},
    validation: null,
    doctor: {},
  };

  // Load existing config or start fresh
  let config;
  try {
    config = loadConfig();
  } catch {
    config = require("./config").defaultConfig();
  }

  const { getConfigPath } = require("./paths");
  const hasExistingConfig = fs.existsSync(getConfigPath());

  let prompter = null;
  if (interactive) {
    prompter = createPrompter(process.stdin, output);
  }

  try {
    // Preamble: check existing config
    if (interactive && hasExistingConfig) {
      printBanner(output);
      output.write("  Existing configuration found. Values will be pre-filled.\n\n");
      const proceed = await prompter.confirm("Continue with setup?", true);
      if (!proceed) {
        output.write("\n  Setup cancelled.\n");
        result.ok = false;
        return result;
      }
      output.write("\n");
    } else if (interactive) {
      printBanner(output);
    }

    // --- Step 1: Server URL ---
    const defaultUrl = config.server.url || "https://prompt.jiun.dev";
    let serverUrl;
    if (options.server) {
      serverUrl = normalizeUrl(options.server);
    } else if (interactive) {
      printStep(output, 1, totalSteps, "Server URL");
      output.write("  Enter the sync server URL.\n");
      const answer = await prompter.ask("Server URL", defaultUrl);
      serverUrl = normalizeUrl(answer);
      output.write("\n");
    } else {
      serverUrl = normalizeUrl(defaultUrl);
    }
    config.server.url = serverUrl;

    // --- Step 2: Authentication ---
    const existingToken = config.server.token;
    let token;
    if (options.token) {
      token = options.token;
    } else if (interactive) {
      printStep(output, 2, totalSteps, "Authentication");
      output.write("  How would you like to authenticate?\n");
      output.write("    1. Login with email & password (recommended)\n");
      output.write("    2. Paste existing token\n");
      const authChoice = await prompter.ask("Choice", "1");

      if (authChoice === "1") {
        // Login flow - ask email first
        const email = await prompter.ask("Email");
        if (!email) {
          output.write("  Email is required.\n\n");
          result.ok = false;
          return result;
        }

        // First, try login with password
        const password = await prompter.askMasked("Password (press Enter if new account)");

        if (password) {
          // Existing account - try to login
          output.write("  Authenticating... ");
          const loginResult = await cliLogin(serverUrl, email, password);

          if (loginResult.ok) {
            token = loginResult.token;
            output.write("OK\n");
            printResult(output, "->", `Logged in as ${loginResult.user.email}`);
            output.write("\n");
          } else if (loginResult.code === "USER_NOT_FOUND") {
            // Account doesn't exist - offer to register with this password
            output.write("account not found.\n");
            const doRegister = await prompter.confirm("Create a new account with this email?", true);
            if (doRegister) {
              let regPassword = password;
              if (regPassword.length < 8) {
                output.write("  Password must be at least 8 characters.\n");
                regPassword = await prompter.askMasked("Password (min 8 chars)");
              }
              const confirmPw = await prompter.askMasked("Confirm password");
              if (regPassword !== confirmPw) {
                output.write("  Passwords do not match.\n\n");
                result.ok = false;
                return result;
              }
              const regName = await prompter.ask("Name (optional)");
              output.write("  Registering... ");
              const regResult = await cliLogin(serverUrl, email, regPassword, true, regName || undefined);
              if (regResult.ok) {
                token = regResult.token;
                output.write("OK\n");
                printResult(output, "->", `Account created for ${regResult.user.email}`);
                output.write("\n");
              } else {
                output.write("FAILED\n");
                printResult(output, "!", regResult.error);
                output.write("\n");
                result.ok = false;
                return result;
              }
            } else {
              output.write("\n");
              result.ok = false;
              return result;
            }
          } else {
            output.write("FAILED\n");
            printResult(output, "!", loginResult.error);
            output.write("\n");
            result.ok = false;
            return result;
          }
        } else {
          // No password entered - new account registration flow
          output.write("\n  Creating a new account for " + email + "\n");
          const regPassword = await prompter.askMasked("Set password (min 8 chars)");
          if (!regPassword || regPassword.length < 8) {
            output.write("  Password must be at least 8 characters.\n\n");
            result.ok = false;
            return result;
          }
          const confirmPw = await prompter.askMasked("Confirm password");
          if (regPassword !== confirmPw) {
            output.write("  Passwords do not match.\n\n");
            result.ok = false;
            return result;
          }
          const regName = await prompter.ask("Name (optional)");
          output.write("  Registering... ");
          const regResult = await cliLogin(serverUrl, email, regPassword, true, regName || undefined);
          if (regResult.ok) {
            token = regResult.token;
            output.write("OK\n");
            printResult(output, "->", `Account created for ${regResult.user.email}`);
            output.write("\n");
          } else {
            output.write("FAILED\n");
            printResult(output, "!", regResult.error);
            output.write("\n");
            result.ok = false;
            return result;
          }
        }
      } else {
        // Manual token paste (original flow)
        output.write("  Paste your authentication token (will not be echoed).\n");
        token = await prompter.askMasked("Token", existingToken ? true : false);
        if (!token && existingToken) {
          token = existingToken;
          printResult(output, "->", "Keeping existing token.");
        }
        output.write("\n");
      }
    } else {
      token = existingToken;
    }

    if (!token && !options["skip-validate"]) {
      if (!interactive) {
        output.write("Error: Token is required. Use --token or --skip-validate.\n");
        result.ok = false;
        process.exitCode = 2;
        return result;
      }
    }
    config.server.token = token || "";

    // --- Step 3: Device Name ---
    const defaultDevice = config.server.deviceId || os.hostname();
    let deviceId;
    if (options.device) {
      deviceId = options.device;
    } else if (interactive) {
      printStep(output, 3, totalSteps, "Device Name");
      output.write("  A name for this machine (used in sync logs).\n");
      deviceId = await prompter.ask("Device name", defaultDevice);
      output.write("\n");
    } else {
      deviceId = defaultDevice;
    }
    config.server.deviceId = deviceId;

    // --- Save config before migration ---
    if (!options["dry-run"]) {
      saveConfig(config);
    }

    // --- DB Migrate ---
    if (!options["dry-run"]) {
      if (interactive) {
        output.write("  Migrating database... ");
      }
      try {
        const { migrateDatabase } = require("./migrate");
        const dbResult = migrateDatabase(config);
        result.db = dbResult;
        if (interactive) {
          output.write(`done (schema v${dbResult.version}).\n\n`);
        }
      } catch (err) {
        result.db = { error: err.message };
        if (interactive) {
          output.write(`failed.\n`);
          printResult(output, "!", `Database error: ${err.message}`);
          output.write("\n");
        }
      }
    } else {
      if (interactive) {
        output.write("  [dry-run] Would migrate database.\n\n");
      }
      result.db = { dryRun: true };
    }

    // --- Step 4: Install Hooks ---
    const cliTargets = resolveCliTargets(options);
    if (interactive) {
      printStep(output, 4, totalSteps, "Install Hooks");
    }

    if (cliTargets.length === 0 && !options["no-hooks"]) {
      if (interactive) {
        output.write("  No supported CLI tools detected (claude, codex, opencode).\n");
        printResult(output, "!", "Skipping hook installation. Install hooks later with: omp install <cli>");
        output.write("\n");
      }
    } else if (options["no-hooks"]) {
      if (interactive) {
        output.write("  Hook installation skipped (--no-hooks).\n\n");
      }
    } else {
      if (interactive) {
        const detected = cliTargets.join(", ");
        output.write(`  Detected CLI tools: ${detected}\n`);
      }

      const {
        installClaudeHook,
        installCodexHook,
        installOpenCodeHook,
      } = require("./hooks");

      for (const cli of cliTargets) {
        let shouldInstall = true;

        if (interactive && !options.yes && !options.y) {
          const cliDisplayName = cli === "claude"
            ? "Claude Code"
            : cli === "codex"
              ? "Codex"
              : "OpenCode";
          shouldInstall = await prompter.confirm(
            `Install ${cliDisplayName} hook?`,
            true
          );
        }

        if (!shouldInstall) {
          result.hooks[cli] = { installed: false, skipped: true };
          continue;
        }

        if (options["dry-run"]) {
          result.hooks[cli] = { installed: false, dryRun: true };
          if (interactive) {
            printResult(output, "->", `[dry-run] Would install ${cli} hook.`);
          }
          continue;
        }

        try {
          if (cli === "claude") {
            const hookPath = installClaudeHook();
            config.hooks.enabled.claude_code = true;
            result.hooks.claude = { installed: true, path: hookPath };
            if (interactive) {
              printResult(output, "->", `Installed: ${hookPath}`);
            }
          } else if (cli === "codex") {
            const codexResult = installCodexHook();
            config.hooks.enabled.codex = codexResult.configured;
            result.hooks.codex = {
              installed: codexResult.configured,
              path: codexResult.scriptPath,
              configPath: codexResult.configPath,
              merged: codexResult.merged,
              conflict: codexResult.conflict,
            };
            if (interactive) {
              printResult(output, "->", `Installed: ${codexResult.scriptPath}`);
              if (codexResult.configured) {
                printResult(output, "->", `Updated: ${codexResult.configPath}`);
              }
              if (codexResult.merged) {
                printResult(output, "->", "Merged via wrapper script.");
              }
              if (codexResult.conflict) {
                printResult(output, "!", "Codex notify is already configured by another tool.");
              }
            }
          } else if (cli === "opencode") {
            const opencodeResult = installOpenCodeHook();
            config.hooks.enabled.opencode = opencodeResult.configured;
            result.hooks.opencode = {
              installed: opencodeResult.configured,
              path: opencodeResult.scriptPath,
              configPath: opencodeResult.configPath,
              conflict: opencodeResult.conflict,
            };
            if (interactive) {
              printResult(output, "->", `Installed: ${opencodeResult.scriptPath}`);
              if (opencodeResult.configured) {
                printResult(output, "->", `Updated: ${opencodeResult.configPath}`);
              }
              if (opencodeResult.conflict) {
                printResult(output, "!", "OpenCode config has non-array 'plugin' field.");
              }
            }
          }
        } catch (err) {
          result.hooks[cli] = { installed: false, error: err.message };
          if (interactive) {
            printResult(output, "!", `Failed to install ${cli} hook: ${err.message}`);
          }
        }
      }

      // Save updated hook config
      if (!options["dry-run"]) {
        saveConfig(config);
      }

      if (interactive) {
        output.write("\n");
      }
    }

    // --- Validate Server ---
    if (!options["skip-validate"] && !options["dry-run"] && config.server.token) {
      if (interactive) {
        output.write("  Validating server connection... ");
      }

      const validation = await validateToken(
        config.server.url,
        config.server.token,
        config.server.deviceId
      );
      result.validation = validation;

      if (validation.valid) {
        if (interactive) {
          output.write(`OK (${validation.status}).\n\n`);
        }
      } else {
        if (interactive) {
          output.write(`FAILED`);
          if (validation.status) {
            output.write(` (${validation.status})`);
          }
          output.write(`.\n`);
          printResult(output, "!", validation.error || "Unknown error");

          if (validation.status === 401 || validation.status === 403) {
            // Offer to re-enter token (up to 2 retries)
            let retries = 2;
            while (retries > 0 && !validation.valid) {
              const retry = await prompter.confirm("Re-enter token?", true);
              if (!retry) break;
              const newToken = await prompter.askMasked("Token");
              if (newToken) {
                config.server.token = newToken;
                saveConfig(config);
                output.write("  Validating... ");
                const retryResult = await validateToken(
                  config.server.url,
                  newToken,
                  config.server.deviceId
                );
                if (retryResult.valid) {
                  output.write(`OK (${retryResult.status}).\n`);
                  result.validation = retryResult;
                  break;
                } else {
                  output.write(`FAILED.\n`);
                  printResult(output, "!", retryResult.error || "Unknown error");
                  result.validation = retryResult;
                }
              }
              retries--;
            }
          } else {
            // Server unreachable - save config anyway
            output.write("  Setup saved locally. Sync will work once the server is available.\n");
          }
          output.write("\n");
        }
      }
    } else if (options["skip-validate"]) {
      result.validation = { valid: true, status: null, error: null, skipped: true };
      if (interactive) {
        output.write("  Server validation skipped (--skip-validate).\n\n");
      }
    } else if (options["dry-run"]) {
      result.validation = { valid: true, status: null, error: null, dryRun: true };
    }

    // --- Doctor ---
    try {
      const { runDoctor } = require("./doctor");
      const doctorReport = runDoctor(config);
      result.doctor = doctorReport;

      if (interactive) {
        output.write("  Running doctor...\n");
        if (doctorReport.checks.db) {
          printResult(output, "  ", `DB:      ${doctorReport.checks.db}`);
        }
        if (doctorReport.checks.hooks) {
          const h = doctorReport.checks.hooks;
          printResult(
            output,
            "  ",
            `Hooks:   claude=${h.claude_code ? "installed" : "not installed"}, codex=${h.codex ? "installed" : "not installed"}, opencode=${h.opencode ? "installed" : "not installed"}`
          );
        }
        printResult(output, "  ", `Sync:    ${config.server.url ? "server configured" : "not configured"}`);
        if (doctorReport.checks.queue) {
          const q = doctorReport.checks.queue;
          printResult(output, "  ", `Queue:   ${q.count} files, ${q.bytes} bytes`);
        }
        if (doctorReport.errors.length) {
          output.write("\n");
          doctorReport.errors.forEach((err) => printResult(output, "!", err));
        }
        if (doctorReport.warnings.length) {
          output.write("\n");
          doctorReport.warnings.forEach((warn) => printResult(output, "~", warn));
        }
        output.write("\n");
      }
    } catch (err) {
      result.doctor = { ok: false, errors: [err.message], warnings: [] };
      if (interactive) {
        output.write(`  Doctor check failed: ${err.message}\n\n`);
      }
    }

    // --- Final output ---
    result.config = {
      serverUrl: config.server.url,
      deviceId: config.server.deviceId,
      sqlitePath: config.storage.sqlite.path,
    };

    const validationOk = !result.validation || result.validation.valid;
    result.ok = validationOk;

    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else if (interactive) {
      output.write("  Setup complete! Try these commands:\n\n");
      output.write("    omp backfill    - Import existing Claude/Codex prompts\n");
      output.write("    omp sync        - Upload prompts to server\n");
      output.write("    omp status      - View current configuration\n");
      output.write("    omp doctor      - Check system health\n");
      output.write("\n");
      output.write("  Tip: Run 'omp backfill' first to import your previous prompts,\n");
      output.write("  then 'omp sync' to upload them to the server.\n");
      output.write("\n");
    }

    return result;
  } finally {
    if (prompter) {
      prompter.close();
    }
  }
}

module.exports = { runSetup };
