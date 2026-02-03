#!/bin/bash
# Remote Claude Session Backup Script - Paired I/O Support
# No dependencies other than curl, openssl, and python3 (standard on macOS)

# Config
MINIO_ENDPOINT="https://minio.jiun.dev"
MINIO_BUCKET="claude-prompts"
MINIO_ACCESS_KEY="$1"
MINIO_SECRET_KEY="$2"
USER_TOKEN="$3"
DRY_RUN="$4"

if [ -z "$MINIO_ACCESS_KEY" ] || [ -z "$MINIO_SECRET_KEY" ] || [ -z "$USER_TOKEN" ]; then
    echo "Usage: $0 <access_key> <secret_key> <token> [--dry-run]"
    exit 1
fi

echo "Starting remote backup (Paired I/O) for token: ${USER_TOKEN:0:8}..."

# Find all session files
files=$(find ~/workspace ~/workspace-ext ~/workspace-vibe ~/.claude -name "*.jsonl" -type f 2>/dev/null)

for file in $files; do
    echo "Processing $file..."
    
    # Extract project dir (if in workspace)
    project_dir="unknown"
    if [[ "$file" == *"/workspace/"* ]]; then
        project_dir=$(echo "$file" | sed -E 's|.*/workspace/([^/]+)/.*|\1|')
    elif [[ "$file" == *"/workspace-ext/"* ]]; then
        project_dir=$(echo "$file" | sed -E 's|.*/workspace-ext/([^/]+)/.*|\1|')
    elif [[ "$file" == *"/workspace-vibe/"* ]]; then
        project_dir=$(echo "$file" | sed -E 's|.*/workspace-vibe/([^/]+)/.*|\1|')
    fi

    # Parse JSONL and upload each prompt + response pair
    python3 - <<EOF
import json, hashlib, datetime, os, subprocess, hmac, base64

access_key = "$MINIO_ACCESS_KEY"
secret_key = "$MINIO_SECRET_KEY"
bucket = "$MINIO_BUCKET"
endpoint = "$MINIO_ENDPOINT"
token = "$USER_TOKEN"
dry_run = "$DRY_RUN" == "--dry-run"
file_path = "$file"
project_dir = "$project_dir"

def upload_to_minio(payload_dict, object_path):
    payload = json.dumps(payload_dict, ensure_ascii=False)
    
    if dry_run:
        print(f"  [DRY RUN] Would upload: {object_path}")
        return

    # S3 Signature V2
    resource = f"/{bucket}/{object_path}"
    date_header = subprocess.check_output(["date", "-R"]).decode('utf-8').strip()
    content_type = "application/json"
    string_to_sign = f"PUT\n\n{content_type}\n{date_header}\n{resource}"
    
    signature = base64.b64encode(hmac.new(secret_key.encode('utf-8'), string_to_sign.encode('utf-8'), hashlib.sha1).digest()).decode('utf-8')
    
    cmd = [
        "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-X", "PUT",
        "-H", f"Date: {date_header}",
        "-H", f"Content-Type: {content_type}",
        "-H", f"Authorization: AWS {access_key}:{signature}",
        "-d", payload,
        f"{endpoint}{resource}"
    ]
    subprocess.run(cmd)

last_input_hash = None
last_input_timestamp = None

with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
    for line in f:
        if not line.strip(): continue
        try:
            entry = json.loads(line)
            timestamp = entry.get('timestamp', '')
            try:
                dt = datetime.datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                date_path = dt.strftime("%Y/%m/%d")
            except (ValueError, KeyError):
                date_path = datetime.datetime.utcnow().strftime("%Y/%m/%d")

            if entry.get('type') == 'user':
                prompt = entry['content']
                content_hash = hashlib.sha256(prompt.encode('utf-8')).hexdigest()[:12]
                last_input_hash = content_hash
                last_input_timestamp = timestamp
                
                object_path = f"{token}/{date_path}/{content_hash}.json"
                upload_to_minio({
                    "timestamp": timestamp,
                    "working_directory": os.path.dirname(file_path),
                    "prompt_length": len(prompt),
                    "prompt": prompt,
                    "project_name": project_dir,
                    "type": "input"
                }, object_path)
            
            elif entry.get('type') == 'assistant' and last_input_hash:
                response = entry['content']
                object_path = f"{token}/{date_path}/{last_input_hash}_output.json"
                upload_to_minio({
                    "timestamp": timestamp,
                    "input_hash": last_input_hash,
                    "input_timestamp": last_input_timestamp,
                    "response": response,
                    "response_length": len(response),
                    "type": "output"
                }, object_path)
        except Exception as e:
            print(f"  [ERROR] Skipping line in {file_path} due to: {e}")
            continue
EOF
done

echo "Backup complete for this machine."
