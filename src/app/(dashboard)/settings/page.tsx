"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { useUser } from "@/contexts/user-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SettingsPage() {
  const { user, loading, refetch } = useUser();
  const { theme, setTheme } = useTheme();
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const regenerateToken = async () => {
    setRegenerating(true);
    setTokenError(null);
    try {
      const res = await fetch("/api/auth/regenerate-token", { method: "POST" });
      if (res.ok) {
        await refetch();
        setShowConfirm(false);
      } else {
        const data = await res.json().catch(() => ({}));
        setTokenError(data.error || "Failed to regenerate token");
      }
    } catch {
      setTokenError("Failed to regenerate token. Please check your connection.");
    } finally {
      setRegenerating(false);
    }
  };

  const copyToken = async () => {
    if (user?.token) {
      await navigator.clipboard.writeText(user.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your prompt workspace
        </p>
      </div>

      <div className="grid gap-6">
        {/* User Token Section */}
        <Card>
          <CardHeader>
            <CardTitle>API Token</CardTitle>
            <CardDescription>
              Your personal token for prompt sync and capture hooks (Claude Code supported)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="h-10 bg-skeleton rounded animate-pulse max-w-md" />
            ) : user?.token ? (
              <>
                <div className="flex gap-3">
                  <Input
                    type="text"
                    value={user.token}
                    readOnly
                    className="font-mono text-sm max-w-md"
                  />
                  <Button
                    variant="outline"
                    onClick={copyToken}
                    className="shrink-0"
                  >
                    {copied ? (
                      <svg
                        className="h-4 w-4 text-green-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    )}
                  </Button>
                </div>
                <div className="bg-surface/50 rounded-lg p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-secondary-foreground mb-2">Quick Setup (Recommended)</p>
                  <p className="mb-2">
                    Run the CLI setup wizard to automatically configure your prompt capture hook:
                  </p>
                  <pre className="bg-surface p-3 rounded text-xs overflow-x-auto">
{`omp setup`}
                  </pre>
                </div>

                {tokenError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                    {tokenError}
                  </div>
                )}

                {/* Regenerate Token */}
                <div className="pt-4 border-t border-border">
                  {showConfirm ? (
                    <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
                      <p className="text-red-300 text-sm mb-3">
                        Are you sure? This will invalidate your current token. You&apos;ll need to update your prompt capture hook configuration.
                      </p>
                      <div className="flex gap-3">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={regenerateToken}
                          disabled={regenerating}
                        >
                          {regenerating ? "Regenerating..." : "Yes, Regenerate"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowConfirm(false)}
                          disabled={regenerating}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => setShowConfirm(true)}
                      className="text-red-400 hover:text-red-300 hover:border-red-800"
                    >
                      <svg
                        className="h-4 w-4 mr-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                      Regenerate Token
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">No token available</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>
              Basic dashboard settings and preferences
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-secondary-foreground">
                Items per page
              </label>
              <select className="flex h-10 w-full max-w-xs rounded-md border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="12">12</option>
                <option value="24">24</option>
                <option value="48">48</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-secondary-foreground">
                Default view
              </label>
              <select className="flex h-10 w-full max-w-xs rounded-md border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="grid">Grid</option>
                <option value="list">List</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              Customize the look and feel of the dashboard
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-secondary-foreground">Theme</label>
              <div className="flex gap-4">
                {(["dark", "light", "system"] as const).map((t) => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="theme"
                      value={t}
                      checked={theme === t}
                      onChange={() => setTheme(t)}
                      className="h-4 w-4 border-border bg-input-bg text-primary focus:ring-ring"
                    />
                    <span className="text-sm text-secondary-foreground capitalize">{t}</span>
                  </label>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
