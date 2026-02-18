"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastTriggeredAt: string | null;
  lastStatus: number | null;
  failCount: number;
  createdAt: string;
}

interface WebhookLog {
  id: string;
  event: string;
  statusCode: number | null;
  responseBody: string | null;
  duration: number | null;
  createdAt: string;
}

const AVAILABLE_EVENTS = [
  { value: "prompt.created", label: "Prompt Created" },
  { value: "prompt.scored", label: "Prompt Scored" },
  { value: "session.started", label: "Session Started" },
  { value: "session.ended", label: "Session Ended" },
  { value: "sync.completed", label: "Sync Completed" },
] as const;

function getStatusBadge(webhook: Webhook) {
  if (!webhook.isActive) {
    return <Badge variant="error">Disabled</Badge>;
  }
  if (webhook.failCount > 0 && webhook.failCount < 10) {
    return <Badge variant="warning">Failing ({webhook.failCount})</Badge>;
  }
  return <Badge variant="success">Active</Badge>;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

export default function WebhooksSettingsPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createUrl, setCreateUrl] = useState("");
  const [createSecret, setCreateSecret] = useState("");
  const [createEvents, setCreateEvents] = useState<string[]>(["prompt.created"]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editSecret, setEditSecret] = useState("");
  const [editClearSecret, setEditClearSecret] = useState(false);
  const [editEvents, setEditEvents] = useState<string[]>([]);
  const [updating, setUpdating] = useState(false);

  // Logs state
  const [logsWebhookId, setLogsWebhookId] = useState<string | null>(null);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Test state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; statusCode: number | null; duration: number } | null>(null);

  const fetchWebhooks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/webhooks");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch webhooks");
      }
      const data = await res.json();
      setWebhooks(data.webhooks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch webhooks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName,
          url: createUrl,
          secret: createSecret || undefined,
          events: createEvents,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create webhook");
      }
      setShowCreateForm(false);
      setCreateName("");
      setCreateUrl("");
      setCreateSecret("");
      setCreateEvents(["prompt.created"]);
      await fetchWebhooks();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create webhook");
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (id: string) => {
    setUpdating(true);
    try {
      const payload: Record<string, unknown> = {
        name: editName,
        url: editUrl,
        events: editEvents,
      };

      // Only include secret if user typed a new one; use clearSecret to explicitly remove
      if (editClearSecret) {
        payload.clearSecret = true;
      } else if (editSecret) {
        payload.secret = editSecret;
      }
      // If editSecret is empty and editClearSecret is false, omit secret entirely to preserve existing

      const res = await fetch(`/api/webhooks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update webhook");
      }
      setEditingId(null);
      await fetchWebhooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update webhook");
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this webhook?")) return;
    try {
      const res = await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete webhook");
      }
      await fetchWebhooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete webhook");
    }
  };

  const handleToggle = async (webhook: Webhook) => {
    try {
      const res = await fetch(`/api/webhooks/${webhook.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !webhook.isActive }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to toggle webhook");
      }
      await fetchWebhooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle webhook");
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await fetch(`/api/webhooks/${id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult({ id, ...data });
    } catch {
      setTestResult({ id, success: false, statusCode: null, duration: 0 });
    } finally {
      setTestingId(null);
    }
  };

  const handleViewLogs = async (webhookId: string) => {
    if (logsWebhookId === webhookId) {
      setLogsWebhookId(null);
      setLogs([]);
      return;
    }
    setLogsWebhookId(webhookId);
    setLoadingLogs(true);
    try {
      const res = await fetch(`/api/webhooks/${webhookId}/logs?limit=20`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
      }
    } catch {
      // Silently fail for logs
    } finally {
      setLoadingLogs(false);
    }
  };

  const startEdit = (webhook: Webhook) => {
    setEditingId(webhook.id);
    setEditName(webhook.name);
    setEditUrl(webhook.url);
    setEditSecret("");
    setEditClearSecret(false);
    setEditEvents(webhook.events);
  };

  const toggleEvent = (event: string, current: string[], setter: (events: string[]) => void) => {
    if (current.includes(event)) {
      if (current.length > 1) {
        setter(current.filter((e) => e !== event));
      }
    } else {
      setter([...current, event]);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Webhooks</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure webhooks to receive real-time notifications when events occur
          </p>
        </div>
        <Button onClick={() => setShowCreateForm(!showCreateForm)}>
          {showCreateForm ? "Cancel" : "Add Webhook"}
        </Button>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create Webhook</CardTitle>
            <CardDescription>
              Add a new webhook endpoint to receive event notifications
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-secondary-foreground">
                  Name
                </label>
                <Input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="My Webhook"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-secondary-foreground">
                  URL
                </label>
                <Input
                  type="url"
                  value={createUrl}
                  onChange={(e) => setCreateUrl(e.target.value)}
                  placeholder="https://example.com/webhook"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-secondary-foreground">
                  Secret (optional)
                </label>
                <Input
                  type="password"
                  value={createSecret}
                  onChange={(e) => setCreateSecret(e.target.value)}
                  placeholder="HMAC signing secret"
                />
                <p className="text-xs text-muted-foreground">
                  Used to sign payloads with HMAC-SHA256. The signature is sent in the X-Webhook-Signature header.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-secondary-foreground">
                  Events
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_EVENTS.map(({ value, label }) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={createEvents.includes(value)}
                        onChange={() =>
                          toggleEvent(value, createEvents, setCreateEvents)
                        }
                        className="h-4 w-4 rounded border-border bg-input-bg text-primary focus:ring-ring"
                      />
                      <span className="text-sm text-secondary-foreground">
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {createError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                  {createError}
                </div>
              )}

              <div className="flex gap-3">
                <Button type="submit" disabled={creating}>
                  {creating ? "Creating..." : "Create Webhook"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Webhooks List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-32 bg-skeleton rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : webhooks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No webhooks configured yet. Add one to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {webhooks.map((webhook) => (
            <Card key={webhook.id}>
              <CardContent className="p-6">
                {editingId === webhook.id ? (
                  /* Edit Mode */
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-secondary-foreground">
                        Name
                      </label>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-secondary-foreground">
                        URL
                      </label>
                      <Input
                        type="url"
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-secondary-foreground">
                        Secret (leave empty to keep current)
                      </label>
                      <Input
                        type="password"
                        value={editSecret}
                        onChange={(e) => setEditSecret(e.target.value)}
                        placeholder="Leave empty to keep current secret"
                        disabled={editClearSecret}
                      />
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editClearSecret}
                          onChange={(e) => {
                            setEditClearSecret(e.target.checked);
                            if (e.target.checked) setEditSecret("");
                          }}
                          className="h-4 w-4 rounded border-border bg-input-bg text-primary focus:ring-ring"
                        />
                        <span className="text-sm text-muted-foreground">
                          Clear secret (disable HMAC signing)
                        </span>
                      </label>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-secondary-foreground">
                        Events
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {AVAILABLE_EVENTS.map(({ value, label }) => (
                          <label
                            key={value}
                            className="flex items-center gap-2 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={editEvents.includes(value)}
                              onChange={() =>
                                toggleEvent(value, editEvents, setEditEvents)
                              }
                              className="h-4 w-4 rounded border-border bg-input-bg text-primary focus:ring-ring"
                            />
                            <span className="text-sm text-secondary-foreground">
                              {label}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Button
                        onClick={() => handleUpdate(webhook.id)}
                        disabled={updating}
                      >
                        {updating ? "Saving..." : "Save"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* View Mode */
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-3">
                          <h3 className="text-base font-semibold text-foreground">
                            {webhook.name}
                          </h3>
                          {getStatusBadge(webhook)}
                        </div>
                        <p className="text-sm text-muted-foreground font-mono break-all">
                          {webhook.url}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {webhook.events.map((event) => (
                        <Badge key={event} variant="secondary">
                          {event}
                        </Badge>
                      ))}
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>
                        Last triggered: {formatRelativeTime(webhook.lastTriggeredAt)}
                      </span>
                      {webhook.lastStatus !== null && (
                        <span>
                          Last status:{" "}
                          <span
                            className={
                              webhook.lastStatus >= 200 && webhook.lastStatus < 300
                                ? "text-green-400"
                                : "text-red-400"
                            }
                          >
                            {webhook.lastStatus}
                          </span>
                        </span>
                      )}
                    </div>

                    {/* Test result */}
                    {testResult && testResult.id === webhook.id && (
                      <div
                        className={`p-3 rounded-lg text-sm ${
                          testResult.success
                            ? "bg-green-500/10 border border-green-500/20 text-green-400"
                            : "bg-red-500/10 border border-red-500/20 text-red-400"
                        }`}
                      >
                        {testResult.success
                          ? `Test successful - Status: ${testResult.statusCode}, Duration: ${testResult.duration}ms`
                          : `Test failed${testResult.statusCode ? ` - Status: ${testResult.statusCode}` : ""}, Duration: ${testResult.duration}ms`}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => startEdit(webhook)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggle(webhook)}
                      >
                        {webhook.isActive ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTest(webhook.id)}
                        disabled={testingId === webhook.id}
                      >
                        {testingId === webhook.id ? "Testing..." : "Test"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewLogs(webhook.id)}
                      >
                        {logsWebhookId === webhook.id ? "Hide Logs" : "View Logs"}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(webhook.id)}
                      >
                        Delete
                      </Button>
                    </div>

                    {/* Logs panel */}
                    {logsWebhookId === webhook.id && (
                      <div className="mt-4 space-y-2">
                        <h4 className="text-sm font-medium text-secondary-foreground">
                          Recent Deliveries
                        </h4>
                        {loadingLogs ? (
                          <div className="h-20 bg-skeleton rounded animate-pulse" />
                        ) : logs.length === 0 ? (
                          <p className="text-sm text-muted-foreground py-4 text-center">
                            No delivery logs yet
                          </p>
                        ) : (
                          <div className="border border-border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-surface border-b border-border">
                                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                                    Event
                                  </th>
                                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                                    Status
                                  </th>
                                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                                    Duration
                                  </th>
                                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                                    Time
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {logs.map((log) => (
                                  <tr
                                    key={log.id}
                                    className="border-b border-border last:border-0"
                                  >
                                    <td className="px-3 py-2 text-foreground">
                                      {log.event}
                                    </td>
                                    <td className="px-3 py-2">
                                      {log.statusCode !== null ? (
                                        <span
                                          className={
                                            log.statusCode >= 200 &&
                                            log.statusCode < 300
                                              ? "text-green-400"
                                              : "text-red-400"
                                          }
                                        >
                                          {log.statusCode}
                                        </span>
                                      ) : (
                                        <span className="text-red-400">
                                          Error
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground">
                                      {log.duration !== null
                                        ? `${log.duration}ms`
                                        : "-"}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground">
                                      {formatRelativeTime(log.createdAt)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
