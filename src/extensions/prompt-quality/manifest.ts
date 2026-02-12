import type { Extension } from "../types";
import { handler } from "./processor";

export const promptQuality: Extension = {
  name: "prompt-quality",
  version: "1.0.0",
  description: "AI quality scoring and topic categorization for prompts",
  cacheTtlHours: 24,
  processor: {
    schedule: "30 3 * * *", // 3:30 AM daily
    jobName: "insight:prompt-quality",
    handler,
  },
};
