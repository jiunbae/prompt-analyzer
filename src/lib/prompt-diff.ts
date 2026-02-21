/**
 * Prompt diff utilities
 *
 * Word-level diff using a space-optimized LCS approach (Hirschberg-style)
 * and Jaccard similarity on word sets. No external dependencies.
 *
 * Memory: O(min(m, n)) instead of O(m * n).
 */

/** Maximum number of tokens per side before truncation */
const MAX_TOKENS = 2000;

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
 * Compute the last row of the LCS length table using O(n) space.
 * This is the forward pass of the Hirschberg algorithm.
 */
function lcsLengths(a: string[], b: string[]): Uint32Array {
  const n = b.length;
  const prev = new Uint32Array(n + 1);
  const curr = new Uint32Array(n + 1);

  for (let i = 0; i < a.length; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(curr[j - 1], prev[j]);
      }
    }
    prev.set(curr);
    curr.fill(0);
  }

  return prev;
}

/**
 * Hirschberg's algorithm: divide-and-conquer LCS diff with O(min(m,n)) space.
 * Produces the same output as the full DP table approach.
 */
function hirschbergDiff(a: string[], b: string[]): DiffSegment[] {
  const m = a.length;
  const n = b.length;

  // Base cases
  if (m === 0) {
    return b.map((w) => ({ type: "added" as const, text: w }));
  }
  if (n === 0) {
    return a.map((w) => ({ type: "removed" as const, text: w }));
  }
  if (m === 1) {
    const idx = b.indexOf(a[0]);
    if (idx === -1) {
      return [
        ...a.map((w) => ({ type: "removed" as const, text: w })),
        ...b.map((w) => ({ type: "added" as const, text: w })),
      ];
    }
    const result: DiffSegment[] = [];
    for (let j = 0; j < idx; j++) result.push({ type: "added", text: b[j] });
    result.push({ type: "unchanged", text: a[0] });
    for (let j = idx + 1; j < n; j++) result.push({ type: "added", text: b[j] });
    return result;
  }

  // Divide: split a in half
  const mid = Math.floor(m / 2);
  const aTop = a.slice(0, mid);
  const aBot = a.slice(mid);

  // Forward pass on top half
  const topRow = lcsLengths(aTop, b);

  // Reverse pass on bottom half
  const aBotRev = aBot.slice().reverse();
  const bRev = b.slice().reverse();
  const botRow = lcsLengths(aBotRev, bRev);

  // Find optimal split point in b
  let bestJ = 0;
  let bestScore = 0;
  for (let j = 0; j <= n; j++) {
    const score = topRow[j] + botRow[n - j];
    if (score > bestScore) {
      bestScore = score;
      bestJ = j;
    }
  }

  // Conquer: recurse on both halves
  const left = hirschbergDiff(aTop, b.slice(0, bestJ));
  const right = hirschbergDiff(aBot, b.slice(bestJ));

  return left.concat(right);
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
 * Compute word-level diff between two texts using Hirschberg's algorithm.
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

  const segments = hirschbergDiff(wordsA, wordsB);
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
