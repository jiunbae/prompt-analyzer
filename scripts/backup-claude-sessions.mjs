import { Client } from "minio";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Helper for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env variables manually to avoid dependency on dotenv if not needed, 
// but we can just read the file.
const envContent = fs.existsSync(path.join(__dirname, "../.env.local")) 
  ? fs.readFileSync(path.join(__dirname, "../.env.local"), "utf-8")
  : "";
const env = Object.fromEntries(
  envContent
    .split("\n")
    .filter(line => line && !line.startsWith("#"))
    .map(line => {
      const [key, ...val] = line.split("=");
      return [key.trim(), val.join("=").trim()];
    })
);

const MINIO_ENDPOINT = env.MINIO_ENDPOINT || process.env.MINIO_ENDPOINT;
if (!MINIO_ENDPOINT) {
  console.error("Error: MINIO_ENDPOINT must be set in .env.local or environment");
  process.exit(1);
}
const MINIO_ACCESS_KEY = env.MINIO_ACCESS_KEY || process.env.MINIO_ACCESS_KEY;
const MINIO_SECRET_KEY = env.MINIO_SECRET_KEY || process.env.MINIO_SECRET_KEY;
const MINIO_BUCKET = env.MINIO_BUCKET || process.env.MINIO_BUCKET || "claude-prompts";

// Multi-user support
const USER_TOKEN = env.USER_TOKEN || process.env.USER_TOKEN || 
                 process.argv.find(arg => arg.startsWith("--user-token="))?.split("=")[1];

const DRY_RUN = process.argv.includes("--dry-run");

if (!MINIO_ACCESS_KEY || !MINIO_SECRET_KEY) {
  console.error("Error: MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be set in .env.local or environment");
  process.exit(1);
}

const minioClient = new Client({
  endPoint: MINIO_ENDPOINT,
  port: 443,
  useSSL: true,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY,
});

/**
 * Hash content to generate a deterministic filename
 */
function getHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
}

/**
 * Load Claude history to map session IDs to projects
 */
function loadHistory() {
  const historyPath = path.join(process.env.HOME, ".claude/history.jsonl");
  const historyMap = new Map();
  
  if (fs.existsSync(historyPath)) {
    const lines = fs.readFileSync(historyPath, "utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.sessionId && entry.project) {
          historyMap.set(entry.sessionId, entry.project);
        }
      } catch (e) {
        // Skip invalid lines
      }
    }
  }
  return historyMap;
}

/**
 * Find all potential session files
 */
function findSessionFiles() {
  const files = [];
  
  // 1. Standard location
  const standardTranscripts = path.join(process.env.HOME, ".claude/transcripts");
  if (fs.existsSync(standardTranscripts)) {
    try {
      fs.readdirSync(standardTranscripts).forEach(file => {
        if (file.endsWith(".jsonl")) {
          files.push({
            path: path.join(standardTranscripts, file),
            source: "standard"
          });
        }
      });
    } catch (e) {
      console.warn(`Could not read standard transcripts: ${e.message}`);
    }
  }
  
  // 2. Workspace locations
  const workspaceRoots = ["workspace", "workspace-ext", "workspace-vibe"];
  
  for (const rootName of workspaceRoots) {
    const workspaceRoot = path.join(process.env.HOME, rootName);
    if (!fs.existsSync(workspaceRoot)) continue;
    
    try {
      const projects = fs.readdirSync(workspaceRoot);
      for (const project of projects) {
        const projectPath = path.join(workspaceRoot, project);
        if (!fs.statSync(projectPath).isDirectory()) continue;
        
        const claudeDir = path.join(projectPath, ".claude");
        if (fs.existsSync(claudeDir)) {
          const scan = (dir) => {
            if (!fs.existsSync(dir)) return;
            try {
              fs.readdirSync(dir).forEach(f => {
                const fullPath = path.join(dir, f);
                try {
                  const stats = fs.lstatSync(fullPath);
                  if (stats.isDirectory()) {
                    scan(fullPath);
                  } else if (f.endsWith(".jsonl")) {
                    files.push({
                      path: fullPath,
                      source: "workspace",
                      projectDir: projectPath
                    });
                  }
                } catch (e) {}
              });
            } catch (e) {}
          };
          scan(claudeDir);
        }
      }
    } catch (e) {
      console.warn(`Could not read workspace root ${rootName}: ${e.message}`);
    }
  }
  
  return files;
}

async function listObjects(prefix) {
  const objects = [];
  return new Promise((resolve, reject) => {
    const stream = minioClient.listObjectsV2(MINIO_BUCKET, prefix, true);
    stream.on("data", obj => objects.push(obj));
    stream.on("error", reject);
    stream.on("end", () => resolve(objects));
  });
}

const contentCache = new Map(); // prefix -> Set of prompt content hashes

async function isAlreadyInMinio(prefix, promptText, timestamp) {
  // We use a combination of prefix and content hash to check
  if (!contentCache.has(prefix)) {
    const objects = await listObjects(prefix);
    const hashes = new Set();
    
    // Optimization: Only download if the folder is small-ish
    if (objects.length < 200) {
      for (const obj of objects) {
        try {
          const dataStream = await minioClient.getObject(MINIO_BUCKET, obj.name);
          const content = await new Promise((resolve, reject) => {
            let d = "";
            dataStream.on("data", chunk => { d += chunk; });
            dataStream.on("end", () => resolve(d));
            dataStream.on("error", reject);
          });
          const parsed = JSON.parse(content);
          // Hash the prompt content for comparison
          hashes.add(getHash(parsed.prompt) + "_" + parsed.timestamp);
        } catch (e) {
          console.warn(`Failed to check existing object ${obj.name}: ${e.message}`);
        }
      }
    } else {
      console.log(`Prefix ${prefix} has many objects (${objects.length}), skipping content-based deduplication for speed. Filename check only.`);
    }
    
    // Also add the filenames (hashes) of existing objects
    for (const obj of objects) {
      const name = path.basename(obj.name, ".json");
      hashes.add(name);
    }
    
    contentCache.set(prefix, hashes);
  }
  
  const currentHash = getHash(promptText);
  const hashes = contentCache.get(prefix);
  
  return hashes.has(currentHash) || hashes.has(currentHash + "_" + timestamp);
}

async function processFile(fileInfo, historyMap) {
  console.log(`Processing ${fileInfo.path}...`);
  
  let content;
  try {
    content = fs.readFileSync(fileInfo.path, "utf-8");
  } catch (e) {
    console.error(`Failed to read ${fileInfo.path}: ${e.message}`);
    return;
  }
  
  const lines = content.split("\n");
  const sessionId = path.basename(fileInfo.path, ".jsonl").replace(/^ses_/, "");
  
  let workingDir = fileInfo.projectDir || historyMap.get(sessionId) || "unknown";
  
  let added = 0;
  let skipped = 0;
  
  let lastInputHash = null;
  let lastInputTimestamp = null;
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    try {
      const entry = JSON.parse(line);
      const timestamp = entry.timestamp;
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) continue;
      
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const day = String(date.getUTCDate()).padStart(2, "0");
      const userPrefix = USER_TOKEN ? `${USER_TOKEN}/` : "";
      const prefix = `${userPrefix}${year}/${month}/${day}/`;

      if (entry.type === "user") {
        const prompt = entry.content;
        const hash = getHash(prompt);
        lastInputHash = hash;
        lastInputTimestamp = timestamp;
        
        const objectName = `${prefix}${hash}.json`;
        
        if (await isAlreadyInMinio(prefix, prompt, timestamp)) {
          skipped++;
          continue;
        }
        
        const payload = {
          timestamp,
          working_directory: workingDir,
          prompt_length: prompt.length,
          prompt: prompt,
          type: "input"
        };
        
        if (DRY_RUN) {
          console.log(`[DRY RUN] Would upload input: ${objectName}`);
        } else {
          await minioClient.putObject(MINIO_BUCKET, objectName, JSON.stringify(payload), { "Content-Type": "application/json" });
          contentCache.get(prefix).add(hash);
        }
        added++;
      } else if (entry.type === "assistant" && lastInputHash) {
        // This is an output prompt linked to the previous input
        const response = entry.content;
        const objectName = `${prefix}${lastInputHash}_output.json`;
        
        // Simple check for output existence (can be more thorough if needed)
        const hashes = contentCache.get(prefix) || new Set();
        if (hashes.has(lastInputHash + "_output")) {
          skipped++;
          continue;
        }

        const payload = {
          timestamp,
          input_hash: lastInputHash,
          input_timestamp: lastInputTimestamp,
          response: response,
          type: "output"
        };

        if (DRY_RUN) {
          console.log(`[DRY RUN] Would upload output: ${objectName}`);
        } else {
          await minioClient.putObject(MINIO_BUCKET, objectName, JSON.stringify(payload), { "Content-Type": "application/json" });
          if (contentCache.has(prefix)) contentCache.get(prefix).add(lastInputHash + "_output");
        }
        added++;
      }
      
    } catch (e) {
      // console.warn(`Error parsing line in ${fileInfo.path}: ${e.message}`);
    }
  }
  
  if (added > 0 || skipped > 0) {
    console.log(`  Done: ${added} added, ${skipped} skipped.`);
  }
}

async function run() {
  console.log("Starting Claude session backup to MinIO...");
  if (USER_TOKEN) {
    console.log(`Using USER_TOKEN: ${USER_TOKEN.slice(0, 8)}...`);
  } else {
    console.warn("No USER_TOKEN provided. Using legacy path structure (root of bucket).");
  }
  if (DRY_RUN) console.log("--- DRY RUN MODE ---");
  
  const historyMap = loadHistory();
  console.log(`Loaded ${historyMap.size} session mappings from history.`);
  
  const files = findSessionFiles();
  console.log(`Found ${files.length} potential session files.`);
  
  for (const file of files) {
    await processFile(file, historyMap);
  }
  
  console.log("\nBackup complete.");
}

run().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
