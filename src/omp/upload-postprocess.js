const { redactText } = require("./redact");

function countWords(text) {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function applyProcessors(record, processors, ctx) {
  return processors.reduce((acc, fn) => fn(acc, ctx), record);
}

function redactSecrets(record, ctx) {
  const options = ctx?.redactOptions || {};

  const prompt = redactText(record.prompt_text, options).text;
  const response =
    record.response_text !== null && record.response_text !== undefined
      ? redactText(record.response_text, options).text
      : record.response_text;

  return { ...record, prompt_text: prompt, response_text: response };
}

function recomputeStats(record) {
  const promptText = record.prompt_text || "";
  const responseText = record.response_text;

  const responseLen = typeof responseText === "string" ? responseText.length : null;
  const tokenEstimateResponse =
    typeof responseText === "string" ? estimateTokens(responseText) : null;
  const wordCountResponse =
    typeof responseText === "string" ? countWords(responseText) : null;

  return {
    ...record,
    prompt_length: promptText.length,
    response_length: responseLen,
    token_estimate: estimateTokens(promptText),
    word_count: countWords(promptText),
    token_estimate_response: tokenEstimateResponse,
    word_count_response: wordCountResponse,
  };
}

const BUILTIN_PROCESSORS = {
  redact_secrets: redactSecrets,
  recompute_stats: recomputeStats,
};

function postprocessUploadRecord(record, config) {
  const syncRedact = config?.sync?.redact;
  const shouldRedactUpload = syncRedact ? syncRedact.enabled !== false : true;

  const processors = [];
  if (shouldRedactUpload) processors.push(BUILTIN_PROCESSORS.redact_secrets);
  processors.push(BUILTIN_PROCESSORS.recompute_stats);

  const ctx = { redactOptions: syncRedact || {} };
  return applyProcessors(record, processors, ctx);
}

module.exports = {
  postprocessUploadRecord,
  applyProcessors,
  BUILTIN_PROCESSORS,
};

