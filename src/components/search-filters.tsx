"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SearchFiltersProps {
  projects: Array<{ name: string; count: number }>;
  tags?: Array<{ id: string; name: string; color?: string | null }>;
  currentSearch?: string;
  currentProject?: string;
  currentType?: string;
  currentFrom?: string;
  currentTo?: string;
  currentTag?: string;
}

export function SearchFilters({
  projects,
  tags = [],
  currentSearch,
  currentProject,
  currentType,
  currentFrom,
  currentTo,
  currentTag,
}: SearchFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState(currentSearch ?? "");
  const [showAdvanced, setShowAdvanced] = useState(
    !!(currentProject || currentType || currentFrom || currentTo || currentTag)
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

      // Reset to page 1 when filters change
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

  const hasFilters = currentSearch || currentProject || currentType || currentFrom || currentTo || currentTag;

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <title>Search Icon</title>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <Input
            type="search"
            placeholder="Search prompts..."
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
            <title>Toggle Filters</title>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          <span className="ml-2">Filters</span>
        </Button>
      </form>

      {/* Advanced Filters */}
      {showAdvanced && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-surface/50 rounded-lg border border-border">
          {/* Project Filter */}
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

          {/* Type Filter */}
          <div className="space-y-1">
            <label htmlFor="type-filter" className="text-xs text-muted-foreground font-medium">Type</label>
            <select
              id="type-filter"
              value={currentType ?? ""}
              onChange={(e) => handleFilterChange("type", e.target.value || undefined)}
              className="w-full px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
            >
              <option value="">All types</option>
              <option value="user_input">User Input</option>
              <option value="task_notification">Task Notification</option>
              <option value="system">System</option>
            </select>
          </div>

          {/* From Date */}
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

          {/* To Date */}
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

          <div className="space-y-1">
            <label htmlFor="tag-filter" className="text-xs text-muted-foreground font-medium">Tag</label>
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                type="button"
                onClick={() => handleFilterChange("tag", undefined)}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  !currentTag 
                    ? "bg-accent text-foreground ring-1 ring-border" 
                    : "bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                All
              </button>
              {tags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleFilterChange("tag", t.name)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    currentTag === t.name
                      ? "ring-1 ring-border shadow-sm"
                      : "opacity-70 hover:opacity-100"
                  }`}
                  style={{
                    backgroundColor: currentTag === t.name ? t.color || "#6366f1" : `${t.color || "#6366f1"}22`,
                    color: currentTag === t.name ? "#fff" : t.color || "#6366f1",
                    borderColor: t.color || "#6366f1",
                    borderWidth: "1px",
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Active Filters */}
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
                ×
              </button>
            </span>
          )}
          {currentProject && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/20 text-green-300 rounded-full text-xs">
              Project: {currentProject}
              <button type="button" onClick={() => handleFilterChange("project", undefined)} className="hover:text-green-100">
                ×
              </button>
            </span>
          )}
          {currentType && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-500/20 text-purple-300 rounded-full text-xs">
              Type: {currentType}
              <button type="button" onClick={() => handleFilterChange("type", undefined)} className="hover:text-purple-100">
                ×
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
                ×
              </button>
            </span>
          )}
          {currentTag && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-500/20 text-yellow-300 rounded-full text-xs">
              Tag: {currentTag}
              <button type="button" onClick={() => handleFilterChange("tag", undefined)} className="hover:text-yellow-100">
                ×
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
