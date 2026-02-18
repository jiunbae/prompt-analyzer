export interface PromptQualityScore {
  overall: number;
  clarity: number;
  specificity: number;
  context: number;
  constraints: number;
  structure: number;
  suggestions: string[];
}

type DimensionScores = Omit<PromptQualityScore, "overall" | "suggestions">;

const IMPERATIVE_VERB_RE =
  /\b(add|build|change|create|debug|document|explain|fix|implement|improve|optimize|refactor|remove|rename|test|update|write)\b/gi;
const GOAL_RE =
  /\b(can you|could you|goal|help me|i need|i want|objective|please|want to|looking to)\b/i;
const VAGUE_RE = /\b(anything|kinda|maybe|something|somehow|stuff|whatever)\b/i;

const FILE_PATH_RE =
  /(?:^|\s)(?:\.{1,2}\/|\/[\w.-]+\/|[a-zA-Z]:\\)[\w./\\-]+(?:\.[a-zA-Z0-9]+)?/g;
const CODE_REF_RE =
  /`[^`]+`|\b[A-Za-z_][A-Za-z0-9_]*\([^)]*\)|\b[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\b/g;
const NUMBER_RE = /\b\d+(?:\.\d+)?(?:%|ms|s|m|h|kb|mb|gb)?\b/gi;
const NAMED_ENTITY_RE =
  /\b(?:Next\.js|Postgres|Redis|TypeScript|Tailwind|React|Drizzle|Docker|Kubernetes|GitHub|OpenAI)\b|\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g;

const CONTEXT_SIGNAL_RE =
  /\b(already|as-is|because|currently|existing|for context|historically|legacy|right now|today|we have|we use)\b/gi;
const BACKGROUND_RE =
  /\b(background|context|previously|so that|in order to|before this|after this|workflow)\b/i;

const CONSTRAINT_SIGNAL_RE =
  /\b(avoid|cannot|do not|don't|limit(?:ed|ation)?|must|must not|no\b|only|should|should not|without|at most|at least|required)\b/gi;
const HARD_LIMIT_RE =
  /\b(no llm|no network|offline|time limit|memory limit|budget|compatib(?:le|ility)|sandbox|production-only|read-only)\b/i;

const BULLET_RE = /^\s*[-*]\s+/gm;
const NUMBERED_RE = /^\s*\d+\.\s+/gm;
const SECTION_RE = /^(?:\s*#{1,6}\s+.+|\s*[A-Z][A-Za-z\s]{2,30}:\s*)$/gm;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function countMatches(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  return text.match(regex)?.length ?? 0;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sentenceCount(text: string): number {
  return text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean).length;
}

export function clarity(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  let score = 42;
  const words = wordCount(trimmed);

  if (trimmed.includes("?")) score += 10;
  score += Math.min(22, countMatches(trimmed, IMPERATIVE_VERB_RE) * 6);
  if (GOAL_RE.test(trimmed)) score += 14;
  if (sentenceCount(trimmed) >= 2) score += 6;
  if (words >= 12 && words <= 220) score += 8;
  if (words < 8) score -= 10;
  if (VAGUE_RE.test(trimmed)) score -= 8;

  return clamp(score);
}

export function specificity(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  let score = 36;
  const filePathHits = countMatches(trimmed, FILE_PATH_RE);
  const codeRefHits = countMatches(trimmed, CODE_REF_RE);
  const numberHits = countMatches(trimmed, NUMBER_RE);
  const namedHits = countMatches(trimmed, NAMED_ENTITY_RE);

  if (filePathHits > 0) score += Math.min(20, filePathHits * 8);
  if (codeRefHits > 0) score += Math.min(18, codeRefHits * 6);
  if (numberHits > 0) score += Math.min(12, numberHits * 4);
  if (namedHits > 0) score += Math.min(10, namedHits * 5);

  if (/\b(this|that|it|thing|stuff)\b/i.test(trimmed)) score -= 6;
  if (filePathHits + codeRefHits + numberHits + namedHits >= 3) score += 8;

  return clamp(score);
}

export function context(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  let score = 34;

  score += Math.min(26, countMatches(trimmed, CONTEXT_SIGNAL_RE) * 7);
  if (BACKGROUND_RE.test(trimmed)) score += 14;
  if (sentenceCount(trimmed) >= 3) score += 10;
  if (/\b(currently|right now|already)\b/i.test(trimmed)) score += 8;

  return clamp(score);
}

export function constraints(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  let score = 30;
  const constraintHits = countMatches(trimmed, CONSTRAINT_SIGNAL_RE);

  score += Math.min(38, constraintHits * 8);
  if (HARD_LIMIT_RE.test(trimmed)) score += 14;
  if (/\b(keep|preserve|maintain|stay within)\b/i.test(trimmed)) score += 8;
  if (constraintHits === 0 && wordCount(trimmed) > 25) score -= 4;

  return clamp(score);
}

export function structure(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  let score = 36;
  const bullets = countMatches(trimmed, BULLET_RE);
  const numbered = countMatches(trimmed, NUMBERED_RE);
  const sections = countMatches(trimmed, SECTION_RE);

  if (bullets > 0) score += Math.min(18, bullets * 6);
  if (numbered > 0) score += Math.min(16, numbered * 6);
  if (sections > 0) score += Math.min(14, sections * 7);
  if (/\n\s*\n/.test(trimmed)) score += 6;

  const chars = trimmed.length;
  if (chars >= 80 && chars <= 1800) score += 12;
  if (chars < 40) score -= 14;
  if (chars > 3000) score -= 6;

  return clamp(score);
}

function buildSuggestions(scores: DimensionScores): string[] {
  const suggestions: string[] = [];

  if (scores.clarity < 70) {
    suggestions.push("State the exact end goal and ask a direct question or action.");
  }
  if (scores.specificity < 70) {
    suggestions.push("Add concrete references like file paths, function names, or numeric targets.");
  }
  if (scores.context < 70) {
    suggestions.push("Include background on current behavior and why the change is needed.");
  }
  if (scores.constraints < 70) {
    suggestions.push("List boundaries explicitly (must, should not, avoid, limits).");
  }
  if (scores.structure < 70) {
    suggestions.push("Use sections or bullets to separate goals, constraints, and acceptance criteria.");
  }

  return suggestions.slice(0, 4);
}

export function scorePrompt(text: string): PromptQualityScore {
  const scores: DimensionScores = {
    clarity: clarity(text),
    specificity: specificity(text),
    context: context(text),
    constraints: constraints(text),
    structure: structure(text),
  };

  const overall = clamp(
    scores.clarity * 0.25 +
      scores.specificity * 0.25 +
      scores.context * 0.2 +
      scores.constraints * 0.15 +
      scores.structure * 0.15,
  );

  return {
    overall,
    ...scores,
    suggestions: buildSuggestions(scores),
  };
}
