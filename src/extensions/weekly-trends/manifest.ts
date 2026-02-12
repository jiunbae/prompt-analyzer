import type { Extension } from "../types";
import { handler } from "./processor";

export const weeklyTrends: Extension = {
  name: "weekly-trends",
  version: "1.0.0",
  description: "Week-over-week trend analysis with key metrics and recommendations",
  cacheTtlHours: 168,
  processor: {
    schedule: "0 4 * * 1", // 4 AM every Monday
    jobName: "insight:weekly-trends",
    handler,
  },
};
