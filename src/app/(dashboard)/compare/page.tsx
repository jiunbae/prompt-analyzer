"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DiffViewer, type DiffPrompt, type DiffSegment } from "@/components/diff-viewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";

interface DiffResponse {
  promptA: DiffPrompt;
  promptB: DiffPrompt;
  diff: DiffSegment[];
  similarity: number;
}

interface PromptOption {
  id: string;
  timestamp: string;
  projectName: string | null;
  preview: string;
}

interface PromptListResult {
  items: PromptOption[];
}

function parseTrpcData<T>(payload: unknown): T | null {
  const root = Array.isArray(payload) ? payload[0] : payload;
  if (!root || typeof root !== "object") return null;

  const result = (root as { result?: unknown }).result;
  if (!result || typeof result !== "object") return null;

  const data = (result as { data?: unknown }).data;
  if (data && typeof data === "object" && "json" in data) {
    return (data as { json: T }).json;
  }

  return (data as T) ?? null;
}

function parseDiffResponse(payload: unknown): DiffResponse | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Partial<DiffResponse>;

  if (
    !data.promptA ||
    !data.promptB ||
    !Array.isArray(data.diff) ||
    typeof data.similarity !== "number"
  ) {
    return null;
  }

  return {
    promptA: data.promptA,
    promptB: data.promptB,
    diff: data.diff,
    similarity: data.similarity,
  };
}

function buildPromptListInput(search: string): string {
  const input = search
    ? { limit: 20, offset: 0, search }
    : { limit: 20, offset: 0 };
  return encodeURIComponent(JSON.stringify(input));
}

export default function ComparePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isRouting, startTransition] = useTransition();

  const urlPromptA = searchParams.get("a") ?? "";
  const urlPromptB = searchParams.get("b") ?? "";

  const [selectedA, setSelectedA] = useState(urlPromptA);
  const [selectedB, setSelectedB] = useState(urlPromptB);

  const [searchA, setSearchA] = useState("");
  const [searchB, setSearchB] = useState("");
  const [optionsA, setOptionsA] = useState<PromptOption[]>([]);
  const [optionsB, setOptionsB] = useState<PromptOption[]>([]);
  const [optionsLoadingA, setOptionsLoadingA] = useState(false);
  const [optionsLoadingB, setOptionsLoadingB] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedA(urlPromptA);
  }, [urlPromptA]);

  useEffect(() => {
    setSelectedB(urlPromptB);
  }, [urlPromptB]);

  const fetchPromptOptions = useCallback(async (query: string): Promise<PromptOption[]> => {
    const input = buildPromptListInput(query.trim());
    const response = await fetch(`/api/trpc/prompts.list?input=${input}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Failed to load prompt options");
    }

    const payload = (await response.json()) as unknown;
    const parsed = parseTrpcData<PromptListResult>(payload);
    return parsed?.items ?? [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setOptionsLoadingA(true);
      try {
        const items = await fetchPromptOptions(searchA);
        if (!cancelled) {
          setOptionsA(items);
          setOptionsError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setOptionsError(error instanceof Error ? error.message : "Failed to load prompts");
        }
      } finally {
        if (!cancelled) {
          setOptionsLoadingA(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchPromptOptions, searchA]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setOptionsLoadingB(true);
      try {
        const items = await fetchPromptOptions(searchB);
        if (!cancelled) {
          setOptionsB(items);
          setOptionsError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setOptionsError(error instanceof Error ? error.message : "Failed to load prompts");
        }
      } finally {
        if (!cancelled) {
          setOptionsLoadingB(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchPromptOptions, searchB]);

  useEffect(() => {
    if (!urlPromptA || !urlPromptB) {
      setDiffData(null);
      setDiffError(null);
      setDiffLoading(false);
      return;
    }

    const controller = new AbortController();

    (async () => {
      setDiffLoading(true);
      setDiffError(null);

      try {
        const response = await fetch(
          `/api/prompts/diff?a=${encodeURIComponent(urlPromptA)}&b=${encodeURIComponent(urlPromptB)}`,
          {
            method: "GET",
            signal: controller.signal,
            cache: "no-store",
          }
        );

        const payload = (await response.json()) as unknown;
        if (!response.ok) {
          const message =
            payload && typeof payload === "object" && "error" in payload
              ? String((payload as { error?: unknown }).error ?? "Failed to load diff")
              : "Failed to load diff";
          throw new Error(message);
        }

        const parsed = parseDiffResponse(payload);
        if (!parsed) {
          throw new Error("Invalid diff response");
        }

        setDiffData(parsed);
      } catch (error) {
        if (!controller.signal.aborted) {
          setDiffData(null);
          setDiffError(error instanceof Error ? error.message : "Failed to load diff");
        }
      } finally {
        if (!controller.signal.aborted) {
          setDiffLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [urlPromptA, urlPromptB]);

  const canCompare = Boolean(selectedA && selectedB && selectedA !== selectedB);

  const handleCompare = useCallback(() => {
    if (!canCompare) return;
    const params = new URLSearchParams({ a: selectedA, b: selectedB });
    startTransition(() => {
      router.push(`/compare?${params.toString()}`);
    });
  }, [canCompare, selectedA, selectedB, router, startTransition]);

  const includeSelectedA = useMemo(
    () => selectedA.length > 0 && !optionsA.some((option) => option.id === selectedA),
    [optionsA, selectedA]
  );

  const includeSelectedB = useMemo(
    () => selectedB.length > 0 && !optionsB.some((option) => option.id === selectedB),
    [optionsB, selectedB]
  );

  const selectedPreviewA = useMemo(
    () => optionsA.find((option) => option.id === selectedA),
    [optionsA, selectedA]
  );

  const selectedPreviewB = useMemo(
    () => optionsB.find((option) => option.id === selectedB),
    [optionsB, selectedB]
  );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Compare Prompts</h1>
        <p className="text-sm text-muted-foreground">
          Select two prompts to view word-level changes and similarity.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="search-a">
              Prompt A
            </label>
            <Input
              id="search-a"
              placeholder="Search prompts..."
              value={searchA}
              onChange={(event) => setSearchA(event.target.value)}
            />
            <select
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              value={selectedA}
              onChange={(event) => setSelectedA(event.target.value)}
            >
              <option value="">Select prompt A</option>
              {includeSelectedA && (
                <option value={selectedA}>
                  {"(URL-selected) " + selectedA.slice(0, 8) + "..."}
                </option>
              )}
              {optionsA.map((option) => (
                <option key={option.id} value={option.id}>
                  {(option.projectName ?? "No project") + " • " + formatDate(option.timestamp)}
                </option>
              ))}
            </select>
            {selectedPreviewA && (
              <p className="text-xs text-muted-foreground line-clamp-2">{selectedPreviewA.preview}</p>
            )}
            {optionsLoadingA && <p className="text-xs text-muted-foreground">Loading options...</p>}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="search-b">
              Prompt B
            </label>
            <Input
              id="search-b"
              placeholder="Search prompts..."
              value={searchB}
              onChange={(event) => setSearchB(event.target.value)}
            />
            <select
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              value={selectedB}
              onChange={(event) => setSelectedB(event.target.value)}
            >
              <option value="">Select prompt B</option>
              {includeSelectedB && (
                <option value={selectedB}>
                  {"(URL-selected) " + selectedB.slice(0, 8) + "..."}
                </option>
              )}
              {optionsB.map((option) => (
                <option key={option.id} value={option.id}>
                  {(option.projectName ?? "No project") + " • " + formatDate(option.timestamp)}
                </option>
              ))}
            </select>
            {selectedPreviewB && (
              <p className="text-xs text-muted-foreground line-clamp-2">{selectedPreviewB.preview}</p>
            )}
            {optionsLoadingB && <p className="text-xs text-muted-foreground">Loading options...</p>}
          </div>
        </div>

        {optionsError && (
          <p className="mt-3 text-sm text-red-500">{optionsError}</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={handleCompare} disabled={!canCompare || isRouting}>
            {isRouting ? "Opening..." : "Compare"}
          </Button>
          {!canCompare && (
            <p className="self-center text-xs text-muted-foreground">
              Select two different prompts to continue.
            </p>
          )}
        </div>
      </div>

      {!urlPromptA || !urlPromptB ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
          Search and select two prompts above to load the diff view.
        </div>
      ) : null}

      {diffLoading && (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Loading diff...
        </div>
      )}

      {diffError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">
          {diffError}
        </div>
      )}

      {diffData && !diffLoading && !diffError && (
        <DiffViewer
          promptA={diffData.promptA}
          promptB={diffData.promptB}
          diff={diffData.diff}
          similarity={diffData.similarity}
        />
      )}
    </div>
  );
}
