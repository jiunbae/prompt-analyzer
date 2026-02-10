import { redactText } from "@/lib/redact";
import type { UploadRecord } from "./upload-types";

export type UploadPostprocessOptions = {
  redactEnabled: boolean;
  redactMask: string;
};

export type UploadPostprocessResult = {
  promptText: string;
  responseText?: string;
  promptLength: number;
  responseLength?: number;
  tokenEstimate: number;
  wordCount: number;
  tokenEstimateResponse?: number;
  wordCountResponse?: number;
};

export function postprocessUploadRecordForDb(
  record: UploadRecord,
  options: UploadPostprocessOptions
): UploadPostprocessResult {
  const promptText = options.redactEnabled
    ? redactText(record.prompt_text, { mask: options.redactMask }).text
    : record.prompt_text;

  const responseText =
    record.response_text === null || record.response_text === undefined
      ? undefined
      : options.redactEnabled
        ? redactText(record.response_text, { mask: options.redactMask }).text
        : record.response_text;

  const promptLength = promptText.length;
  const responseLength = typeof responseText === "string" ? responseText.length : undefined;

  const tokenEstimate = Math.ceil(promptLength / 4);
  const wordCount = promptText.split(/\s+/).filter(Boolean).length;

  const tokenEstimateResponse =
    typeof responseText === "string" ? Math.ceil(responseLength! / 4) : undefined;
  const wordCountResponse =
    typeof responseText === "string" ? responseText.split(/\s+/).filter(Boolean).length : undefined;

  return {
    promptText,
    responseText,
    promptLength,
    responseLength,
    tokenEstimate,
    wordCount,
    tokenEstimateResponse,
    wordCountResponse,
  };
}

