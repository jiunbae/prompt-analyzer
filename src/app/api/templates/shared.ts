import { z } from "zod";

export const CATEGORIES = [
  "debugging",
  "code-review",
  "feature",
  "refactoring",
  "testing",
  "documentation",
  "other",
] as const;

export const templateVariableSchema = z.object({
  name: z.string().min(1).max(100).regex(/^\w+$/, "Variable names must be alphanumeric/underscore only"),
  default: z.string().max(1000).default(""),
  description: z.string().max(500).default(""),
});
