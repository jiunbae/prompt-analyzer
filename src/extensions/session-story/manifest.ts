import type { Extension } from "../types";
import { handler } from "./processor";

export const sessionStory: Extension = {
  name: "session-story",
  version: "1.0.0",
  description: "Narrative summary of a coding session's progression and outcomes",
  cacheTtlHours: 24,
  processor: {
    jobName: "insight:session-story",
    // No schedule — on-demand only
    handler,
  },
};
