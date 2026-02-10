"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/contexts/user-context";
import { SessionCard } from "@/components/session-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SessionItem {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  promptCount: number;
  responseCount: number;
  projectName?: string | null;
  source?: string | null;
  deviceName?: string | null;
  userId?: string | null;
  firstPrompt: string;
  totalTokens?: number;
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

function shortenPath(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 3) return path;
  return ".../" + parts.slice(-2).join("/");
}

function AdminSessionsContent() {
  const { user, loading: userLoading } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [projects, setProjects] = useState<FilterOption[]>([]);
  const [sources, setSources] = useState<FilterOption[]>([]);
  const [devices, setDevices] = useState<FilterOption[]>([]);
  const [workspaces, setWorkspaces] = useState<FilterOption[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentPage = parseInt(searchParams.get("page") ?? "1", 10);
  const currentUserId = searchParams.get("userId") ?? "";
  const currentSearch = searchParams.get("search") ?? "";
  const currentProject = searchParams.get("project") ?? "";
  const currentSource = searchParams.get("source") ?? "";
  const currentDevice = searchParams.get("device") ?? "";
  const currentWorkspace = searchParams.get("workspace") ?? "";
  const currentFrom = searchParams.get("from") ?? "";
  const currentTo = searchParams.get("to") ?? "";
  const pageSize = 20;

  const [searchInput, setSearchInput] = useState(currentSearch);
  const [showFilters, setShowFilters] = useState(
    !!(currentProject || currentSource || currentDevice || currentWorkspace || currentFrom || currentTo)
  );

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (currentUserId) params.set("userId", currentUserId);
      if (currentSearch) params.set("search", currentSearch);
      if (currentProject) params.set("project", currentProject);
      if (currentSource) params.set("source", currentSource);
      if (currentDevice) params.set("device", currentDevice);
      if (currentWorkspace) params.set("workspace", currentWorkspace);
      if (currentFrom) params.set("from", currentFrom);
      if (currentTo) params.set("to", currentTo);
      params.set("page", currentPage.toString());

      const res = await fetch(`/api/admin/sessions?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions);
        setTotalCount(data.totalCount);
        if (data.users) setUsers(data.users);
        if (data.projects) setProjects(data.projects);
        if (data.sources) setSources(data.sources);
        if (data.devices) setDevices(data.devices);
        if (data.workspaces) setWorkspaces(data.workspaces);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed to fetch sessions (${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch sessions");
    } finally {
      setLoading(false);
    }
  }, [currentUserId, currentSearch, currentProject, currentSource, currentDevice, currentWorkspace, currentFrom, currentTo, currentPage]);

  useEffect(() => {
    if (!userLoading && user?.isAdmin) {
      fetchSessions();
    }
  }, [userLoading, user, fetchSessions]);

  useEffect(() => {
    if (!userLoading && user && !user.isAdmin) {
      router.push("/sessions");
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
      router.push(`/admin/sessions?${params.toString()}`);
    },
    [searchParams, router]
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    updateParams({ search: searchInput || undefined });
  };

  const handleClearFilters = () => {
    setSearchInput("");
    router.push("/admin/sessions");
  };

  if (userLoading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-24 bg-skeleton rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!user?.isAdmin) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>Admin access required.</p>
      </div>
    );
  }

  const totalPages = Math.ceil(totalCount / pageSize);
  const hasFilters = currentSearch || currentProject || currentSource || currentDevice || currentWorkspace || currentFrom || currentTo || currentUserId;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">All Sessions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse sessions across all users ({totalCount} total)
        </p>
      </div>

      {/* Top filters: User + Device + Workspace */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="space-y-1">
          <label htmlFor="user-filter" className="text-xs text-muted-foreground font-medium">User</label>
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
          <label htmlFor="device-filter" className="text-xs text-muted-foreground font-medium">Device</label>
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
          <label htmlFor="workspace-filter" className="text-xs text-muted-foreground font-medium">Workspace</label>
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
              placeholder="Search sessions..."
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
              <label htmlFor="adm-source-filter" className="text-xs text-muted-foreground font-medium">Source</label>
              <select
                id="adm-source-filter"
                value={currentSource}
                onChange={(e) => updateParams({ source: e.target.value || undefined })}
                className="w-full px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
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
            {currentSource && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-500/20 text-purple-300 rounded-full text-xs">
                Source: {currentSource}
                <button type="button" onClick={() => updateParams({ source: undefined })} className="hover:text-purple-100">x</button>
              </span>
            )}
            {(currentFrom || currentTo) && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-500/20 text-orange-300 rounded-full text-xs">
                Date: {currentFrom || "..."} - {currentTo || "..."}
                <button type="button" onClick={() => updateParams({ from: undefined, to: undefined })} className="hover:text-orange-100">x</button>
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

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-24 bg-skeleton rounded-lg animate-pulse" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No sessions found.</p>
          {hasFilters && <p className="text-sm mt-1">Try adjusting your filters.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <SessionCard
              key={s.sessionId}
              sessionId={s.sessionId}
              firstPrompt={s.firstPrompt}
              startedAt={s.startedAt}
              endedAt={s.endedAt}
              promptCount={s.promptCount}
              responseCount={s.responseCount}
              projectName={s.projectName}
              source={s.source}
              deviceName={s.deviceName}
              totalTokens={s.totalTokens}
            />
          ))}
        </div>
      )}

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
              disabled={currentPage <= 1}
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString());
                params.set("page", String(currentPage - 1));
                router.push(`/admin/sessions?${params.toString()}`);
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString());
                params.set("page", String(currentPage + 1));
                router.push(`/admin/sessions?${params.toString()}`);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminSessionsPage() {
  return (
    <Suspense fallback={
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-24 bg-skeleton rounded-lg animate-pulse" />
        ))}
      </div>
    }>
      <AdminSessionsContent />
    </Suspense>
  );
}
