"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface FilterOption {
  name: string;
  count: number;
}

interface SessionFiltersProps {
  projects: FilterOption[];
  sources: FilterOption[];
  devices?: FilterOption[];
  workspaces?: FilterOption[];
  currentSearch?: string;
  currentProject?: string;
  currentSource?: string;
  currentDevice?: string;
  currentWorkspace?: string;
  currentFrom?: string;
  currentTo?: string;
}

export function SessionFilters({
  projects,
  sources,
  devices = [],
  workspaces = [],
  currentSearch,
  currentProject,
  currentSource,
  currentDevice,
  currentWorkspace,
  currentFrom,
  currentTo,
}: SessionFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState(currentSearch ?? "");
  const [showAdvanced, setShowAdvanced] = useState(
    !!(currentProject || currentSource || currentDevice || currentWorkspace || currentFrom || currentTo)
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

  const hasFilters = currentSearch || currentProject || currentSource || currentDevice || currentWorkspace || currentFrom || currentTo;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
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
            className="pl-10"
          />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "..." : "Search"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className=""
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
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 bg-surface/50 rounded-lg border border-border">
          <div className="space-y-1">
            <label htmlFor="project-filter" className="text-xs text-muted-foreground font-medium">Project</label>
            <select
              id="project-filter"
              value={currentProject ?? ""}
              onChange={(e) => handleFilterChange("project", e.target.value || undefined)}
              className="w-full px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
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
            <label htmlFor="source-filter" className="text-xs text-muted-foreground font-medium">Agent</label>
            <select
              id="source-filter"
              value={currentSource ?? ""}
              onChange={(e) => handleFilterChange("source", e.target.value || undefined)}
              className="w-full px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
            >
              <option value="">All agents</option>
              {sources.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.count})
                </option>
              ))}
            </select>
          </div>

          {devices.length > 0 && (
            <div className="space-y-1">
              <label htmlFor="device-filter" className="text-xs text-muted-foreground font-medium">Device</label>
              <select
                id="device-filter"
                value={currentDevice ?? ""}
                onChange={(e) => handleFilterChange("device", e.target.value || undefined)}
                className="w-full px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
              >
                <option value="">All devices</option>
                {devices.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name} ({d.count})
                  </option>
                ))}
              </select>
            </div>
          )}

          {workspaces.length > 0 && (
            <div className="space-y-1">
              <label htmlFor="workspace-filter" className="text-xs text-muted-foreground font-medium">Workspace</label>
              <select
                id="workspace-filter"
                value={currentWorkspace ?? ""}
                onChange={(e) => handleFilterChange("workspace", e.target.value || undefined)}
                className="w-full px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
              >
                <option value="">All workspaces</option>
                {workspaces.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.name.split("/").slice(-2).join("/")} ({w.count})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="from-filter" className="text-xs text-muted-foreground font-medium">From Date</label>
            <input
              id="from-filter"
              type="date"
              value={currentFrom ?? ""}
              onChange={(e) => handleFilterChange("from", e.target.value || undefined)}
              className="w-full px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="to-filter" className="text-xs text-muted-foreground font-medium">To Date</label>
            <input
              id="to-filter"
              type="date"
              value={currentTo ?? ""}
              onChange={(e) => handleFilterChange("to", e.target.value || undefined)}
              className="w-full px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
            />
          </div>
        </div>
      )}

      {hasFilters && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Active filters:</span>
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
              <button type="button" onClick={() => handleFilterChange("project", undefined)} className="hover:text-green-100">x</button>
            </span>
          )}
          {currentSource && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/20 text-blue-300 rounded-full text-xs">
              Agent: {currentSource}
              <button type="button" onClick={() => handleFilterChange("source", undefined)} className="hover:text-blue-100">x</button>
            </span>
          )}
          {currentDevice && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-cyan-500/20 text-cyan-300 rounded-full text-xs">
              Device: {currentDevice}
              <button type="button" onClick={() => handleFilterChange("device", undefined)} className="hover:text-cyan-100">x</button>
            </span>
          )}
          {currentWorkspace && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-500/20 text-purple-300 rounded-full text-xs">
              Workspace: {currentWorkspace.split("/").slice(-2).join("/")}
              <button type="button" onClick={() => handleFilterChange("workspace", undefined)} className="hover:text-purple-100">x</button>
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
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
