/**
 * Template Detector Service
 *
 * Analyzes user's prompts to find common patterns and suggest templates.
 * Groups similar prompts by structure, extracts variable parts as {{placeholders}}.
 */

export interface SuggestedTemplate {
  title: string;
  template: string;
  variables: Array<{ name: string; default: string; description: string }>;
  category: string;
  matchCount: number;
  sampleValues: Record<string, string[]>;
}

/**
 * Detect common patterns in prompt texts.
 */
const PATTERN_SIGNATURES: Array<{
  pattern: RegExp;
  title: string;
  category: string;
  template: string;
  variables: Array<{ name: string; default: string; description: string }>;
}> = [
  {
    pattern: /review\s+(?:the\s+)?(?:following\s+)?(?:code|changes|implementation)/i,
    title: "Code Review Request",
    category: "code-review",
    template:
      "Review the following {{language}} code for potential issues, best practices, and improvements:\n\n```{{language}}\n{{code}}\n```\n\nFocus on: {{focus_areas}}",
    variables: [
      { name: "language", default: "TypeScript", description: "Programming language" },
      { name: "code", default: "", description: "Code to review" },
      { name: "focus_areas", default: "readability, performance, error handling", description: "Areas to focus on" },
    ],
  },
  {
    pattern: /(?:debug|fix|troubleshoot|investigate)\s+(?:this|the|an?)\s+(?:error|issue|bug|problem)/i,
    title: "Debug Issue",
    category: "debugging",
    template:
      "I'm encountering the following {{error_type}} in my {{language}} project:\n\n```\n{{error_message}}\n```\n\nRelevant code:\n```{{language}}\n{{code}}\n```\n\nWhat I've tried: {{attempts}}",
    variables: [
      { name: "error_type", default: "error", description: "Type of error (e.g. runtime, type, build)" },
      { name: "language", default: "TypeScript", description: "Programming language" },
      { name: "error_message", default: "", description: "The error message or stack trace" },
      { name: "code", default: "", description: "Relevant code snippet" },
      { name: "attempts", default: "", description: "What you've already tried" },
    ],
  },
  {
    pattern: /(?:implement|create|build|add|write)\s+(?:a|an|the)\s+(?:new\s+)?(?:feature|function|component|endpoint|api)/i,
    title: "Feature Implementation",
    category: "feature",
    template:
      "Implement a {{feature_type}} that {{description}}.\n\nRequirements:\n{{requirements}}\n\nTech stack: {{tech_stack}}\n\nExisting patterns to follow:\n{{patterns}}",
    variables: [
      { name: "feature_type", default: "feature", description: "Type (component, API endpoint, function, etc.)" },
      { name: "description", default: "", description: "What the feature should do" },
      { name: "requirements", default: "", description: "Specific requirements" },
      { name: "tech_stack", default: "", description: "Technologies being used" },
      { name: "patterns", default: "", description: "Existing patterns to follow" },
    ],
  },
  {
    pattern: /(?:refactor|improve|clean\s*up|optimize|simplify)\s+(?:this|the|my)/i,
    title: "Refactoring Request",
    category: "refactoring",
    template:
      "Refactor the following {{language}} code to improve {{goals}}:\n\n```{{language}}\n{{code}}\n```\n\nConstraints: {{constraints}}",
    variables: [
      { name: "language", default: "TypeScript", description: "Programming language" },
      { name: "goals", default: "readability and maintainability", description: "What to improve" },
      { name: "code", default: "", description: "Code to refactor" },
      { name: "constraints", default: "Maintain backward compatibility", description: "Any constraints" },
    ],
  },
  {
    pattern: /(?:write|add|create)\s+(?:unit\s+)?tests?\s+(?:for|to\s+cover)/i,
    title: "Write Tests",
    category: "testing",
    template:
      "Write {{test_type}} tests for the following {{language}} code:\n\n```{{language}}\n{{code}}\n```\n\nTest framework: {{framework}}\nCover: {{coverage_areas}}",
    variables: [
      { name: "test_type", default: "unit", description: "Type of tests (unit, integration, e2e)" },
      { name: "language", default: "TypeScript", description: "Programming language" },
      { name: "code", default: "", description: "Code to test" },
      { name: "framework", default: "vitest", description: "Test framework" },
      { name: "coverage_areas", default: "happy path, edge cases, error handling", description: "What to test" },
    ],
  },
];

/**
 * Analyze user prompts to detect common patterns and suggest templates.
 */
export async function detectTemplates(
  prompts: Array<{ promptText: string }>
): Promise<SuggestedTemplate[]> {
  const suggestions: SuggestedTemplate[] = [];
  const matchCounts = new Map<string, number>();

  for (const prompt of prompts) {
    for (const sig of PATTERN_SIGNATURES) {
      if (sig.pattern.test(prompt.promptText)) {
        const count = (matchCounts.get(sig.title) || 0) + 1;
        matchCounts.set(sig.title, count);
      }
    }
  }

  for (const sig of PATTERN_SIGNATURES) {
    const count = matchCounts.get(sig.title) || 0;
    if (count >= 2) {
      suggestions.push({
        title: sig.title,
        template: sig.template,
        variables: sig.variables,
        category: sig.category,
        matchCount: count,
        sampleValues: {},
      });
    }
  }

  // Sort by match count descending
  suggestions.sort((a, b) => b.matchCount - a.matchCount);

  return suggestions;
}
