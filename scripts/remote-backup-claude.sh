#!/bin/bash
# Remote Claude Session Backup Script - Paired I/O Support
# No dependencies other than curl, openssl, and python3 (standard on macOS)

# Config
MINIO_ENDPOINT="https://minio.example.com"
MINIO_BUCKET="oh-my-prompt"
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
    export FILE_PATH="$file"
    export PROJECT_DIR="$project_dir"
    export MINIO_ACCESS_KEY_ENV="$MINIO_ACCESS_KEY"
    export MINIO_SECRET_KEY_ENV="$MINIO_SECRET_KEY"
    export USER_TOKEN_ENV="$USER_TOKEN"
    export DRY_RUN_ENV="$DRY_RUN"

    python3 - <<'EOF'
import json, hashlib, datetime, os, subprocess, hmac, urllib.parse

access_key = os.environ.get("MINIO_ACCESS_KEY_ENV")
secret_key = os.environ.get("MINIO_SECRET_KEY_ENV")
bucket = "oh-my-prompt"
endpoint = "https://minio.example.com"
token = os.environ.get("USER_TOKEN_ENV")
dry_run = os.environ.get("DRY_RUN_ENV") == "--dry-run"
file_path = os.environ.get("FILE_PATH")
project_dir = os.environ.get("PROJECT_DIR")

def sign(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

def object_exists(object_path):
    # S3 Signature V4 for HEAD request
    now = datetime.datetime.utcnow()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    region = "us-east-1"
    service = "s3"
    
    resource = f"/{bucket}/{object_path}"
    parsed = urllib.parse.urlparse(endpoint)
    host = parsed.netloc or parsed.path
    empty_payload_hash = hashlib.sha256(b"").hexdigest()

    canonical_uri = resource
    canonical_querystring = ""
    canonical_headers = f"host:{host}\nx-amz-date:{amz_date}\n"
    signed_headers = "host;x-amz-date"
    canonical_request = f"HEAD\n{canonical_uri}\n{canonical_querystring}\n{canonical_headers}\n{signed_headers}\n{empty_payload_hash}"

    algorithm = "AWS4-HMAC-SHA256"
    credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"
    string_to_sign = f"{algorithm}\n{amz_date}\n{credential_scope}\n{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"

    k_date = sign(("AWS4" + secret_key).encode("utf-8"), date_stamp)
    k_region = sign(k_date, region)
    k_service = sign(k_region, service)
    k_signing = sign(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    authorization_header = f"{algorithm} Credential={access_key}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}"

    cmd = [
        "curl", "-s", "-I", "-o", "/dev/null", "-w", "%{http_code}", "-X", "HEAD",
        "-H", f"Host: {host}",
        "-H", f"x-amz-content-sha256: {empty_payload_hash}",
        "-H", f"x-amz-date: {amz_date}",
        "-H", f"Authorization: {authorization_header}",
        f"{endpoint}{resource}"
    ]
    try:
        result = subprocess.check_output(cmd).decode('utf-8').strip()
        return result == "200"
    except Exception:
        return False

def upload_to_minio(payload_dict, object_path):
    if object_exists(object_path):
        return

    payload = json.dumps(payload_dict, ensure_ascii=False)
    
    if dry_run:
        print(f"  [DRY RUN] Would upload: {object_path}")
        return

    # S3 Signature V4 for PUT request
    resource = f"/{bucket}/{object_path}"
    content_type = "application/json"
    now = datetime.datetime.utcnow()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    region = "us-east-1"
    service = "s3"

    parsed = urllib.parse.urlparse(endpoint)
    host = parsed.netloc or parsed.path
    payload_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()

    canonical_uri = resource
    canonical_querystring = ""
    canonical_headers = (
        f"content-type:{content_type}\n"
        f"host:{host}\n"
        f"x-amz-content-sha256:{payload_hash}\n"
        f"x-amz-date:{amz_date}\n"
    )
    signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date"
    canonical_request = (
        "PUT\n"
        f"{canonical_uri}\n"
        f"{canonical_querystring}\n"
        f"{canonical_headers}\n"
        f"{signed_headers}\n"
        f"{payload_hash}"
    )

    algorithm = "AWS4-HMAC-SHA256"
    credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"
    string_to_sign = (
        f"{algorithm}\n"
        f"{amz_date}\n"
        f"{credential_scope}\n"
        f"{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"
    )

    k_date = sign(("AWS4" + secret_key).encode("utf-8"), date_stamp)
    k_region = sign(k_date, region)
    k_service = sign(k_region, service)
    k_signing = sign(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    authorization_header = (
        f"{algorithm} Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    
    cmd = [
        "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-X", "PUT",
        "-H", f"Host: {host}",
        "-H", f"Content-Type: {content_type}",
        "-H", f"x-amz-content-sha256: {payload_hash}",
        "-H", f"x-amz-date: {amz_date}",
        "-H", f"Authorization: {authorization_header}",
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
