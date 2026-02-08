export interface SessionSegment {
  start: Date;
  end: Date;
  promptCount: number;
}

/**
 * Groups chronologically-ordered prompt timestamps into sessions
 * using a gap-based heuristic (default: 30 minutes).
 */
export function computeSessions(
  rows: Array<{ timestamp: Date }>,
  gapMs = 30 * 60 * 1000
): SessionSegment[] {
  const sessions: SessionSegment[] = [];

  for (const row of rows) {
    const ts = new Date(row.timestamp);
    const last = sessions[sessions.length - 1];

    if (!last) {
      sessions.push({ start: ts, end: ts, promptCount: 1 });
      continue;
    }

    const gap = ts.getTime() - last.end.getTime();
    if (gap > gapMs) {
      sessions.push({ start: ts, end: ts, promptCount: 1 });
    } else {
      last.end = ts;
      last.promptCount += 1;
    }
  }

  return sessions;
}
