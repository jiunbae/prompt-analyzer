import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Tag {
  id: string;
  name: string;
  color?: string | null;
}

interface PromptCardProps {
  id: string;
  timestamp: Date;
  projectName?: string | null;
  preview: string;
  promptType: "user_input" | "task_notification" | "system" | "user" | "assistant";
  tokenCount: number;
  tags?: Tag[];
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

const promptTypeColors: Record<string, "default" | "secondary" | "success"> = {
  user: "default",
  system: "secondary",
  assistant: "success",
};

export function PromptCard({
  id,
  timestamp,
  projectName,
  preview,
  promptType,
  tokenCount,
  tags = [],
}: PromptCardProps) {
  return (
    <Link href={`/prompts/${id}`} className="block">
      <Card className="p-4 transition-colors hover:border-border hover:bg-accent/50 cursor-pointer">
        <div className="flex items-start justify-between mb-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{formatDate(timestamp)}</span>
            {projectName && (
              <Badge variant="secondary" className="w-fit">
                {projectName}
              </Badge>
            )}
          </div>
          <Badge variant={promptTypeColors[promptType]}>{promptType}</Badge>
        </div>

        <p className="text-sm text-secondary-foreground line-clamp-3 mb-3 font-mono">
          {preview}
        </p>

        <div className="flex items-center justify-between">
          <div className="flex gap-1.5 flex-wrap">
            {tags.slice(0, 3).map((tag) => (
              <Badge
                key={tag.id}
                variant="secondary"
                className="text-xs"
                style={tag.color ? { backgroundColor: `${tag.color}22`, color: tag.color, borderColor: tag.color } : undefined}
              >
                {tag.name}
              </Badge>
            ))}
            {tags.length > 3 && (
              <Badge variant="secondary" className="text-xs">
                +{tags.length - 3}
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {formatTokenCount(tokenCount)} tokens
          </span>
        </div>
      </Card>
    </Link>
  );
}
