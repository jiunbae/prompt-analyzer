"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SessionFiltersProps {
  projects: Array<{ name: string; count: number }>;
  sources: Array<{ name: string; count: number }>;
  currentSearch?: string;
  currentProject?: string;
  currentSource?: string;
  currentFrom?: string;
  currentTo?: string;
}

export function SessionFilters({
  projects,
  sources,
  currentSearch,
  currentProject,
  currentSource,
  currentFrom,
  currentTo,
}: SessionFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState(currentSearch ?? "");
  const [showAdvanced, setShowAdvanced] = useState(
    !!(currentProject || currentSource || currentFrom || currentTo)
  );

  const createQueryString = useCallback(
    (params: Record<string, string | undefined>) => {
      const current = new URLSearchParams(Array.from(searchParams.entries()));

      Object.entries(params).forEach(([key, value]) => {
        if (value) {
          current.set(key, value);
        } else {
          current.delete(key);
        }
      });

      current.delete("page");
      return current.toString();
    },
    [searchParams]
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(() => {
      router.push(pathname + "?" + createQueryString({ search: search || undefined }));
    });
  };

  const handleFilterChange = (key: string, value: string | undefined) => {
    startTransition(() => {
      router.push(pathname + "?" + createQueryString({ [key]: value }));
    });
  };

  const handleClearFilters = () => {
    setSearch("");
    startTransition(() => {
      router.push(pathname);
    });
  };

  const hasFilters = currentSearch || currentProject || currentSource || currentFrom || currentTo;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <Input
            type="search"
            placeholder="Search sessions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
          />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "..." : "Search"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="border-zinc-700"
        >
          <svg
            className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          <span className="ml-2">Filters</span>
        </Button>
      </form>

      {showAdvanced && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
          <div className="space-y-1">
            <label htmlFor="project-filter" className="text-xs text-zinc-400 font-medium">Project</label>
            <select
              id="project-filter"
              value={currentProject ?? ""}
              onChange={(e) => handleFilterChange("project", e.target.value || undefined)}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-md text-zinc-100 text-sm"
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.count})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="source-filter" className="text-xs text-zinc-400 font-medium">Source</label>
            <select
              id="source-filter"
              value={currentSource ?? ""}
              onChange={(e) => handleFilterChange("source", e.target.value || undefined)}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-md text-zinc-100 text-sm"
            >
              <option value="">All sources</option>
              {sources.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.count})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="from-filter" className="text-xs text-zinc-400 font-medium">From Date</label>
            <input
              id="from-filter"
              type="date"
              value={currentFrom ?? ""}
              onChange={(e) => handleFilterChange("from", e.target.value || undefined)}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-md text-zinc-100 text-sm"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="to-filter" className="text-xs text-zinc-400 font-medium">To Date</label>
            <input
              id="to-filter"
              type="date"
              value={currentTo ?? ""}
              onChange={(e) => handleFilterChange("to", e.target.value || undefined)}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-md text-zinc-100 text-sm"
            />
          </div>
        </div>
      )}

      {hasFilters && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-zinc-500">Active filters:</span>
          {currentSearch && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded-full text-xs">
              Search: &quot;{currentSearch}&quot;
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  handleFilterChange("search", undefined);
                }}
                className="hover:text-indigo-100"
              >
                x
              </button>
            </span>
          )}
          {currentProject && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/20 text-green-300 rounded-full text-xs">
              Project: {currentProject}
              <button type="button" onClick={() => handleFilterChange("project", undefined)} className="hover:text-green-100">
                x
              </button>
            </span>
          )}
          {currentSource && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/20 text-blue-300 rounded-full text-xs">
              Source: {currentSource}
              <button type="button" onClick={() => handleFilterChange("source", undefined)} className="hover:text-blue-100">
                x
              </button>
            </span>
          )}
          {(currentFrom || currentTo) && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-500/20 text-orange-300 rounded-full text-xs">
              Date: {currentFrom ?? "..."} - {currentTo ?? "..."}
              <button
                type="button"
                onClick={() => {
                  handleFilterChange("from", undefined);
                  handleFilterChange("to", undefined);
                }}
                className="hover:text-orange-100"
              >
                x
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={handleClearFilters}
            className="text-xs text-zinc-400 hover:text-zinc-200 underline"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
