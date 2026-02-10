export type RedactOptions = {
  mask?: string;
};

type Pattern = {
  name: string;
  regex: RegExp;
  replace?: string;
};

const DEFAULT_PATTERNS: Pattern[] = [
  {
    name: "api_key_generic",
    regex: /((?:api|access|secret|token|password)[-_ ]?key\s*[:=]\s*)(["']?)[^\s"']{8,}\2/gi,
    replace: "$1$2[REDACTED]$2",
  },
  {
    name: "bearer",
    regex: /(authorization\s*[:=]\s*bearer\s+)[A-Za-z0-9._-]{10,}/gi,
    replace: "$1[REDACTED]",
  },
  { name: "openai", regex: /sk-[A-Za-z0-9]{20,}/g, replace: "[REDACTED]" },
  { name: "github", regex: /gh[pousr]_[A-Za-z0-9]{20,}/g, replace: "[REDACTED]" },
  { name: "github_pat", regex: /github_pat_[A-Za-z0-9_]{20,}/g, replace: "[REDACTED]" },
  { name: "slack", regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g, replace: "[REDACTED]" },
  { name: "aws_access", regex: /AKIA[0-9A-Z]{16}/g, replace: "[REDACTED]" },
  {
    name: "aws_secret",
    regex: /((?:aws_secret_access_key|aws_secret|secret_access_key)\s*[:=]\s*)(["']?)[A-Za-z0-9/+=]{20,}\2/gi,
    replace: "$1$2[REDACTED]$2",
  },
  { name: "google_api", regex: /AIza[0-9A-Za-z\-_]{35}/g, replace: "[REDACTED]" },
  { name: "stripe", regex: /(sk|rk|pk)_live_[A-Za-z0-9]{20,}/g, replace: "[REDACTED]" },
  {
    name: "jwt",
    regex: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replace: "[REDACTED]",
  },
  {
    name: "private_key",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: "[REDACTED_PRIVATE_KEY]",
  },
];

export function redactText(text: string, options: RedactOptions = {}) {
  if (!text) return { text: "", count: 0 };

  const mask = options.mask || "[REDACTED]";
  let output = text;
  let count = 0;

  for (const pattern of DEFAULT_PATTERNS) {
    // Reset stateful regexes (global/sticky) before reuse.
    try {
      pattern.regex.lastIndex = 0;
    } catch {
      // ignore
    }

    const matches = output.match(pattern.regex);
    if (!matches || matches.length === 0) continue;
    count += matches.length;

    if (!pattern.replace) {
      output = output.replace(pattern.regex, mask);
      continue;
    }

    const replacement = pattern.replace.replace("[REDACTED]", mask);
    output = output.replace(pattern.regex, replacement);
  }

  return { text: output, count };
}

