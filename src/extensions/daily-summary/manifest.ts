import type { Extension } from "../types";
import { handler } from "./processor";

export const dailySummary: Extension = {
  name: "daily-summary",
  version: "1.0.0",
  description: "AI-generated daily activity summary with trends and highlights",
  cacheTtlHours: 24,
  processor: {
    schedule: "0 3 * * *", // 3 AM daily
    jobName: "insight:daily-summary",
    handler,
  },
};
