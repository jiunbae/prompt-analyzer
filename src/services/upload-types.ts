export interface UploadRecord {
  event_id: string;
  created_at: string;
  prompt_text: string;
  response_text?: string | null;
  prompt_length: number;
  response_length?: number | null;
  project?: string | null;
  cwd?: string | null;
  source?: string;
  session_id?: string | null;
  role?: string;
  model?: string | null;
  cli_name?: string;
  cli_version?: string | null;
  token_estimate?: number;
  token_estimate_response?: number | null;
  word_count?: number;
  word_count_response?: number | null;
  content_hash?: string;
}

export interface UploadResult {
  success: boolean;
  accepted: number;
  duplicates: number;
  rejected: number;
  errors: string[];
}

