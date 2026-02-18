/**
 * Prompt diff utilities
 *
 * Word-level diff using Longest Common Subsequence (LCS) algorithm
 * and Jaccard similarity on word sets. No external dependencies.
 */

/** Maximum number of tokens per side before truncation */
const MAX_TOKENS = 5000;

export interface DiffSegment {
  type: "added" | "removed" | "unchanged";
  text: string;
  /** True when the segment was produced from truncated input */
  truncated?: boolean;
}

/**
 * Tokenize text into words and whitespace runs, preserving exact
 * whitespace so that concatenating all tokens reproduces the original text.
 */
function tokenize(text: string): string[] {
  const tokens = text.match(/\s+|\S+/g);
  return tokens ?? [];
}

/**
 * Compute the LCS (Longest Common Subsequence) table for two arrays of words.
 * Returns the DP table for backtracking.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  // Use typed arrays for better performance on large inputs
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

/**
 * Backtrack through the LCS table to produce diff segments.
 */
function backtrack(
  dp: number[][],
  a: string[],
  b: string[],
  i: number,
  j: number
): DiffSegment[] {
  const segments: DiffSegment[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      segments.push({ type: "unchanged", text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      segments.push({ type: "added", text: b[j - 1] });
      j--;
    } else {
      segments.push({ type: "removed", text: a[i - 1] });
      i--;
    }
  }

  segments.reverse();
  return segments;
}

/**
 * Merge consecutive segments of the same type to reduce output size.
 * Tokens already carry their own whitespace, so we concatenate directly.
 */
function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
  if (segments.length === 0) return [];

  const merged: DiffSegment[] = [{ ...segments[0] }];

  for (let i = 1; i < segments.length; i++) {
    const last = merged[merged.length - 1];
    if (last.type === segments[i].type) {
      last.text += segments[i].text;
    } else {
      merged.push({ ...segments[i] });
    }
  }

  return merged;
}

/**
 * Compute word-level diff between two texts using LCS.
 *
 * Inputs exceeding MAX_TOKENS tokens per side are truncated and a
 * warning segment is appended so the caller knows the diff is partial.
 *
 * @param textA - Original text (left side)
 * @param textB - Modified text (right side)
 * @returns Array of diff segments with type and text
 */
export function computeDiff(textA: string, textB: string): DiffSegment[] {
  let wordsA = tokenize(textA);
  let wordsB = tokenize(textB);
  let wasTruncated = false;

  if (wordsA.length > MAX_TOKENS) {
    wordsA = wordsA.slice(0, MAX_TOKENS);
    wasTruncated = true;
  }
  if (wordsB.length > MAX_TOKENS) {
    wordsB = wordsB.slice(0, MAX_TOKENS);
    wasTruncated = true;
  }

  // Edge cases
  if (wordsA.length === 0 && wordsB.length === 0) return [];
  if (wordsA.length === 0) {
    return [{ type: "added", text: wordsB.join("") }];
  }
  if (wordsB.length === 0) {
    return [{ type: "removed", text: wordsA.join("") }];
  }

  const dp = lcsTable(wordsA, wordsB);
  const segments = backtrack(dp, wordsA, wordsB, wordsA.length, wordsB.length);
  const merged = mergeSegments(segments);

  if (wasTruncated) {
    merged.push({
      type: "unchanged",
      text: "\n\n[... diff truncated — input exceeded token limit]",
      truncated: true,
    });
  }

  return merged;
}

/**
 * Tokenize into non-whitespace words only (for similarity comparison).
 */
function tokenizeWords(text: string): string[] {
  const tokens = text.match(/\S+/g);
  return tokens ?? [];
}

/**
 * Compute Jaccard similarity between two texts based on word sets.
 *
 * @param textA - First text
 * @param textB - Second text
 * @returns Similarity score between 0 and 1
 */
export function computeSimilarity(textA: string, textB: string): number {
  const wordsA = new Set(tokenizeWords(textA.toLowerCase()));
  const wordsB = new Set(tokenizeWords(textB.toLowerCase()));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      intersection++;
    }
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
