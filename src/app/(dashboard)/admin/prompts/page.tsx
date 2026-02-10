"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/contexts/user-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";

interface Tag {
  id: string;
  name: string;
  color?: string | null;
}

interface PromptItem {
  id: string;
  timestamp: string;
  projectName?: string | null;
  preview: string;
  promptType: string;
  tokenCount: number;
  tags: Tag[];
  user: { name: string | null; email: string } | null;
  source?: string | null;
  deviceName?: string | null;
  workingDirectory?: string | null;
}

interface UserOption {
  id: string;
  name: string | null;
  email: string;
}

interface FilterOption {
  name: string;
  count: number;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));
}

function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

function shortenPath(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 3) return path;
  return ".../" + parts.slice(-2).join("/");
}

const promptTypeColors: Record<string, "default" | "secondary" | "success"> = {
  user_input: "default",
  system: "secondary",
  task_notification: "success",
};

export default function AdminPromptsPageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-muted-foreground" />
        </div>
      }
    >
      <AdminPromptsPage />
    </Suspense>
  );
}

function AdminPromptsPage() {
  const { user, loading: userLoading } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [projects, setProjects] = useState<FilterOption[]>([]);
  const [devices, setDevices] = useState<FilterOption[]>([]);
  const [workspaces, setWorkspaces] = useState<FilterOption[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentPage = parseInt(searchParams.get("page") ?? "1", 10);
  const currentUserId = searchParams.get("userId") ?? "";
  const currentSearch = searchParams.get("search") ?? "";
  const currentProject = searchParams.get("project") ?? "";
  const currentType = searchParams.get("type") ?? "";
  const currentDevice = searchParams.get("device") ?? "";
  const currentWorkspace = searchParams.get("workspace") ?? "";
  const currentFrom = searchParams.get("from") ?? "";
  const currentTo = searchParams.get("to") ?? "";
  const currentTag = searchParams.get("tag") ?? "";
  const pageSize = 20;

  const [searchInput, setSearchInput] = useState(currentSearch);
  const [showFilters, setShowFilters] = useState(
    !!(currentProject || currentType || currentDevice || currentWorkspace || currentFrom || currentTo || currentTag)
  );

  const fetchPrompts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (currentUserId) params.set("userId", currentUserId);
      if (currentSearch) params.set("search", currentSearch);
      if (currentProject) params.set("project", currentProject);
      if (currentType) params.set("type", currentType);
      if (currentDevice) params.set("device", currentDevice);
      if (currentWorkspace) params.set("workspace", currentWorkspace);
      if (currentFrom) params.set("from", currentFrom);
      if (currentTo) params.set("to", currentTo);
      if (currentTag) params.set("tag", currentTag);
      params.set("page", currentPage.toString());

      const res = await fetch(`/api/admin/prompts?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch prompts");
      const data = await res.json();
      setPrompts(data.items);
      setTotalCount(data.totalCount);
      setProjects(data.projects);
      setTags(data.allTags);
      if (data.users) setUsers(data.users);
      if (data.devices) setDevices(data.devices);
      if (data.workspaces) setWorkspaces(data.workspaces);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [currentUserId, currentSearch, currentProject, currentType, currentDevice, currentWorkspace, currentFrom, currentTo, currentTag, currentPage]);

  useEffect(() => {
    if (!userLoading && user?.isAdmin) {
      fetchPrompts();
    }
  }, [userLoading, user, fetchPrompts]);

  useEffect(() => {
    if (!userLoading && user && !user.isAdmin) {
      router.push("/prompts");
    }
  }, [userLoading, user, router]);

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      params.delete("page");
      router.push(`/admin/prompts?${params.toString()}`);
    },
    [searchParams, router]
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    updateParams({ search: searchInput || undefined });
  };

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", page.toString());
    router.push(`/admin/prompts?${params.toString()}`);
  };

  const handleClearFilters = () => {
    setSearchInput("");
    router.push("/admin/prompts");
  };

  if (userLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-muted-foreground" />
      </div>
    );
  }

  if (!user?.isAdmin) return null;

  const totalPages = Math.ceil(totalCount / pageSize);
  const hasFilters = currentSearch || currentProject || currentType || currentDevice || currentWorkspace || currentFrom || currentTo || currentTag || currentUserId;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">All Prompts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse prompts across all users ({totalCount} total)
        </p>
      </div>

      {/* Top filters: User + Device */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="space-y-1">
          <label htmlFor="user-filter" className="text-xs text-muted-foreground font-medium">
            User
          </label>
          <select
            id="user-filter"
            value={currentUserId}
            onChange={(e) => updateParams({ userId: e.target.value || undefined })}
            className="w-full sm:w-64 px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
          >
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email.split("@")[0]} ({u.email})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="device-filter" className="text-xs text-muted-foreground font-medium">
            Device
          </label>
          <select
            id="device-filter"
            value={currentDevice}
            onChange={(e) => updateParams({ device: e.target.value || undefined })}
            className="w-full sm:w-64 px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
          >
            <option value="">All devices</option>
            {devices.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name} ({d.count})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="workspace-filter" className="text-xs text-muted-foreground font-medium">
            Workspace
          </label>
          <select
            id="workspace-filter"
            value={currentWorkspace}
            onChange={(e) => updateParams({ workspace: e.target.value || undefined })}
            className="w-full sm:w-64 px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
          >
            <option value="">All workspaces</option>
            {workspaces.map((w) => (
              <option key={w.name} value={w.name}>
                {shortenPath(w.name)} ({w.count})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Search + Advanced Filters */}
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
              placeholder="Search prompts..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button type="submit">Search</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            className=""
          >
            <svg
              className={`h-4 w-4 transition-transform ${showFilters ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span className="ml-2">Filters</span>
          </Button>
        </form>

        {showFilters && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-surface/50 rounded-lg border border-border">
            <div className="space-y-1">
              <label htmlFor="adm-project-filter" className="text-xs text-muted-foreground font-medium">Project</label>
              <select
                id="adm-project-filter"
                value={currentProject}
                onChange={(e) => updateParams({ project: e.target.value || undefined })}
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
              <label htmlFor="adm-type-filter" className="text-xs text-muted-foreground font-medium">Type</label>
              <select
                id="adm-type-filter"
                value={currentType}
                onChange={(e) => updateParams({ type: e.target.value || undefined })}
                className="w-full px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
              >
                <option value="">All types</option>
                <option value="user_input">User Input</option>
                <option value="task_notification">Task Notification</option>
                <option value="system">System</option>
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="adm-from-filter" className="text-xs text-muted-foreground font-medium">From Date</label>
              <input
                id="adm-from-filter"
                type="date"
                value={currentFrom}
                onChange={(e) => updateParams({ from: e.target.value || undefined })}
                className="w-full px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="adm-to-filter" className="text-xs text-muted-foreground font-medium">To Date</label>
              <input
                id="adm-to-filter"
                type="date"
                value={currentTo}
                onChange={(e) => updateParams({ to: e.target.value || undefined })}
                className="w-full px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
              />
            </div>

            {tags.length > 0 && (
              <div className="space-y-1 col-span-2 md:col-span-4">
                <label className="text-xs text-muted-foreground font-medium">Tag</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => updateParams({ tag: undefined })}
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
                      onClick={() => updateParams({ tag: t.name })}
                      className={`px-2 py-1 rounded text-xs transition-colors ${
                        currentTag === t.name
                          ? "ring-1 ring-border shadow-sm"
                          : "opacity-70 hover:opacity-100"
                      }`}
                      style={{
                        backgroundColor:
                          currentTag === t.name
                            ? t.color || "#6366f1"
                            : `${t.color || "#6366f1"}22`,
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
            )}
          </div>
        )}

        {/* Active filter badges */}
        {hasFilters && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Active filters:</span>
            {currentUserId && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/20 text-blue-300 rounded-full text-xs">
                User: {users.find((u) => u.id === currentUserId)?.email ?? currentUserId}
                <button type="button" onClick={() => updateParams({ userId: undefined })} className="hover:text-blue-100">x</button>
              </span>
            )}
            {currentDevice && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-cyan-500/20 text-cyan-300 rounded-full text-xs">
                Device: {currentDevice}
                <button type="button" onClick={() => updateParams({ device: undefined })} className="hover:text-cyan-100">x</button>
              </span>
            )}
            {currentWorkspace && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-teal-500/20 text-teal-300 rounded-full text-xs">
                Workspace: {shortenPath(currentWorkspace)}
                <button type="button" onClick={() => updateParams({ workspace: undefined })} className="hover:text-teal-100">x</button>
              </span>
            )}
            {currentSearch && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded-full text-xs">
                Search: &quot;{currentSearch}&quot;
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    updateParams({ search: undefined });
                  }}
                  className="hover:text-indigo-100"
                >x</button>
              </span>
            )}
            {currentProject && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/20 text-green-300 rounded-full text-xs">
                Project: {currentProject}
                <button type="button" onClick={() => updateParams({ project: undefined })} className="hover:text-green-100">x</button>
              </span>
            )}
            {currentType && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-500/20 text-purple-300 rounded-full text-xs">
                Type: {currentType}
                <button type="button" onClick={() => updateParams({ type: undefined })} className="hover:text-purple-100">x</button>
              </span>
            )}
            {(currentFrom || currentTo) && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-500/20 text-orange-300 rounded-full text-xs">
                Date: {currentFrom || "..."} - {currentTo || "..."}
                <button type="button" onClick={() => updateParams({ from: undefined, to: undefined })} className="hover:text-orange-100">x</button>
              </span>
            )}
            {currentTag && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-500/20 text-yellow-300 rounded-full text-xs">
                Tag: {currentTag}
                <button type="button" onClick={() => updateParams({ tag: undefined })} className="hover:text-yellow-100">x</button>
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

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-4 animate-pulse">
              <div className="h-4 w-24 bg-skeleton rounded mb-3" />
              <div className="h-3 w-full bg-skeleton rounded mb-2" />
              <div className="h-3 w-3/4 bg-skeleton rounded mb-2" />
              <div className="h-3 w-1/2 bg-skeleton rounded" />
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && prompts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <svg
            className="h-16 w-16 text-muted-foreground mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
            />
          </svg>
          <h3 className="text-lg font-medium text-secondary-foreground mb-2">No prompts found</h3>
          <p className="text-sm text-muted-foreground">
            {hasFilters ? "Try adjusting your filters." : "No prompts have been synced yet."}
          </p>
        </div>
      )}

      {/* Prompt cards */}
      {!loading && prompts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {prompts.map((prompt) => (
            <Link key={prompt.id} href={`/prompts/${prompt.id}`}>
              <Card className="p-4 transition-colors hover:border-border hover:bg-accent/50 cursor-pointer h-full flex flex-col">
                {/* Header: timestamp + user + device */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(prompt.timestamp)}
                    </span>
                    {prompt.user && (
                      <span className="text-xs text-blue-400 truncate">
                        {prompt.user.name || prompt.user.email.split("@")[0]}
                      </span>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      {prompt.deviceName && (
                        <span className="text-xs text-cyan-400/70 flex items-center gap-1">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          {prompt.deviceName}
                        </span>
                      )}
                      {prompt.source && (
                        <span className="text-xs text-muted-foreground">
                          {prompt.source}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant={promptTypeColors[prompt.promptType] ?? "default"}>
                      {prompt.promptType}
                    </Badge>
                    {prompt.projectName && (
                      <Badge variant="secondary" className="text-xs">
                        {prompt.projectName}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Workspace */}
                {prompt.workingDirectory && prompt.workingDirectory !== "unknown" && (
                  <div className="text-xs text-muted-foreground mb-2 font-mono truncate" title={prompt.workingDirectory}>
                    {shortenPath(prompt.workingDirectory)}
                  </div>
                )}

                {/* Preview */}
                <p className="text-sm text-secondary-foreground line-clamp-3 mb-3 font-mono flex-1">
                  {prompt.preview}
                </p>

                {/* Footer: tags + tokens */}
                <div className="flex items-center justify-between">
                  <div className="flex gap-1.5 flex-wrap">
                    {prompt.tags.slice(0, 3).map((tag) => (
                      <Badge
                        key={tag.id}
                        variant="secondary"
                        className="text-xs"
                        style={
                          tag.color
                            ? {
                                backgroundColor: `${tag.color}22`,
                                color: tag.color,
                                borderColor: tag.color,
                              }
                            : undefined
                        }
                      >
                        {tag.name}
                      </Badge>
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatTokenCount(prompt.tokenCount)} tokens
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <span className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * pageSize + 1}-
            {Math.min(currentPage * pageSize, totalCount)} of {totalCount}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
