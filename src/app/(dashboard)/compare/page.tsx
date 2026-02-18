"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { DiffViewer } from "@/components/diff-viewer";
import type { DiffSegment, DiffPrompt } from "@/components/diff-viewer";

interface DiffResponse {
  promptA: DiffPrompt;
  promptB: DiffPrompt;
  diff: DiffSegment[];
  similarity: number;
}

function CompareContent() {
  const searchParams = useSearchParams();
  const idA = searchParams.get("a");
  const idB = searchParams.get("b");

  const [data, setData] = useState<DiffResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!idA || !idB) return;
    setLoading(true);
    setError(null);
    fetch(`/api/prompts/diff?a=${idA}&b=${idB}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load diff (${res.status})`);
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [idA, idB]);

  if (!idA || !idB) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h2 className="mb-2 text-lg font-semibold text-foreground">Compare Prompts</h2>
        <p className="text-sm text-muted-foreground">
          Select two prompts to compare. Use the &quot;Compare&quot; button on any prompt detail page,
          or navigate directly with <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/compare?a=id1&amp;b=id2</code>
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="ml-3 text-sm text-muted-foreground">Loading diff...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return <DiffViewer promptA={data.promptA} promptB={data.promptB} diff={data.diff} similarity={data.similarity} />;
}

export default function ComparePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Compare Prompts</h1>
        <p className="text-sm text-muted-foreground">Side-by-side diff of two prompts</p>
      </div>
      <Suspense fallback={<div className="py-20 text-center text-sm text-muted-foreground">Loading...</div>}>
        <CompareContent />
      </Suspense>
    </div>
  );
}
