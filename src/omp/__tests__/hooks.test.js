const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  installCodexHook,
  uninstallCodexHook,
  installOpenCodeHook,
  uninstallOpenCodeHook,
  listHookStatus,
} = require("../hooks");

function withTempEnv(run) {
  const original = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    CODEX_HOME: process.env.CODEX_HOME,
    OPENCODE_CONFIG_HOME: process.env.OPENCODE_CONFIG_HOME,
  };

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-hooks-"));
  const xdgConfigHome = path.join(root, ".config");
  const codexHome = path.join(root, ".codex");
  const opencodeConfigHome = path.join(xdgConfigHome, "opencode");

  process.env.XDG_CONFIG_HOME = xdgConfigHome;
  process.env.CODEX_HOME = codexHome;
  process.env.OPENCODE_CONFIG_HOME = opencodeConfigHome;

  fs.mkdirSync(xdgConfigHome, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(opencodeConfigHome, { recursive: true });

  try {
    run({ root, xdgConfigHome, codexHome, opencodeConfigHome });
  } finally {
    process.env.XDG_CONFIG_HOME = original.XDG_CONFIG_HOME;
    process.env.CODEX_HOME = original.CODEX_HOME;
    process.env.OPENCODE_CONFIG_HOME = original.OPENCODE_CONFIG_HOME;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("hooks", () => {
  it("merges and restores codex notify config when original notify is a string command", () => {
    withTempEnv(({ codexHome }) => {
      const codexConfigPath = path.join(codexHome, "config.toml");
      fs.writeFileSync(codexConfigPath, 'notify = "echo codex-notify"\n');

      const installResult = installCodexHook();
      expect(installResult.configured).toBe(true);
      expect(installResult.conflict).toBe(false);
      expect(installResult.merged).toBe(true);

      const installedConfig = fs.readFileSync(codexConfigPath, "utf-8");
      expect(installedConfig).toContain(installResult.wrapperPath);

      const chain = JSON.parse(fs.readFileSync(installResult.chainPath, "utf-8"));
      expect(chain.original).toBe("echo codex-notify");

      const notifyScript = fs.readFileSync(installResult.scriptPath, "utf-8");
      expect(notifyScript).toContain("event_id:");
      expect(notifyScript).toContain("codex:");

      const uninstallResult = uninstallCodexHook();
      expect(uninstallResult.restored).toBe(true);

      const restoredConfig = fs.readFileSync(codexConfigPath, "utf-8");
      expect(restoredConfig).toContain('notify = "echo codex-notify"');
    });
  });

  it("installs and uninstalls opencode plugin hook", () => {
    withTempEnv(({ opencodeConfigHome }) => {
      const installResult = installOpenCodeHook();
      expect(installResult.configured).toBe(true);
      expect(installResult.conflict).toBe(false);
      expect(fs.existsSync(installResult.scriptPath)).toBe(true);

      const opencodeConfigPath = path.join(opencodeConfigHome, "opencode.json");
      const opencodeConfig = JSON.parse(fs.readFileSync(opencodeConfigPath, "utf-8"));
      expect(Array.isArray(opencodeConfig.plugin)).toBe(true);
      expect(opencodeConfig.plugin).toContain(installResult.scriptPath);

      // OpenCode config may use file URL form; status/uninstall should still work.
      opencodeConfig.plugin = [pathToFileURL(installResult.scriptPath).href];
      fs.writeFileSync(opencodeConfigPath, JSON.stringify(opencodeConfig, null, 2) + "\n");
      const installedStatus = listHookStatus();
      expect(installedStatus.opencode).toBe(true);

      const uninstallResult = uninstallOpenCodeHook();
      expect(uninstallResult.removed).toBe(true);

      const updatedConfig = JSON.parse(fs.readFileSync(opencodeConfigPath, "utf-8"));
      expect(updatedConfig.plugin).not.toContain(installResult.scriptPath);
      expect(listHookStatus().opencode).toBe(false);
    });
  });
});
