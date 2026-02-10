import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface SessionCardProps {
  sessionId: string;
  firstPrompt: string;
  startedAt: string;
  endedAt: string;
  promptCount: number;
  responseCount: number;
  projectName?: string | null;
  source?: string | null;
  deviceName?: string | null;
  totalTokens?: number;
}

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateStr));
}

function formatDuration(startStr: string, endStr: string): string {
  const ms = new Date(endStr).getTime() - new Date(startStr).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.round((ms % 3_600_000) / 60_000);
  return `${hours}h ${mins}m`;
}

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return count.toString();
}

export function SessionCard({
  sessionId,
  firstPrompt,
  startedAt,
  endedAt,
  promptCount,
  responseCount,
  projectName,
  source,
  totalTokens,
}: SessionCardProps) {
  return (
    <Link href={`/sessions/${sessionId}`} className="block">
      <Card className="transition-colors hover:bg-accent/50 cursor-pointer">
        <CardContent className="p-4">
          <p className="text-sm text-foreground line-clamp-2 mb-3">
            {firstPrompt || "Empty prompt"}
          </p>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{formatDate(startedAt)}</span>
            <span className="text-muted-foreground/50">·</span>
            <span>{formatDuration(startedAt, endedAt)}</span>
            <span className="text-muted-foreground/50">·</span>
            <span>
              {promptCount} prompt{promptCount !== 1 ? "s" : ""}
            </span>
            {responseCount > 0 && (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span>{responseCount} response{responseCount !== 1 ? "s" : ""}</span>
              </>
            )}
            {totalTokens != null && totalTokens > 0 && (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span>{formatTokens(totalTokens)} tokens</span>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            {projectName && (
              <Badge variant="secondary">{projectName}</Badge>
            )}
            {source && (
              <Badge variant="outline">{source}</Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
