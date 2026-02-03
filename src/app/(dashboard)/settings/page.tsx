"use client";

import { useState } from "react";
import { useUser } from "@/contexts/user-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SettingsPage() {
  const { user, loading } = useUser();
  const [copied, setCopied] = useState(false);

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
        <h1 className="text-2xl font-semibold text-zinc-100">Settings</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Configure your dashboard preferences
        </p>
      </div>

      <div className="grid gap-6">
        {/* User Token Section */}
        <Card>
          <CardHeader>
            <CardTitle>API Token</CardTitle>
            <CardDescription>
              Your personal token for MinIO uploads and Claude Code hook integration
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="h-10 bg-zinc-800 rounded animate-pulse max-w-md" />
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
                <div className="bg-zinc-800/50 rounded-lg p-4 text-sm text-zinc-400">
                  <p className="font-medium text-zinc-300 mb-2">Claude Code Hook Configuration</p>
                  <p className="mb-2">
                    Use this token when configuring your Claude Code hook to upload prompts:
                  </p>
                  <pre className="bg-zinc-900 p-3 rounded text-xs overflow-x-auto">
{`# In your Claude Code hook script:
export PROMPT_MANAGER_TOKEN="${user.token}"
export PROMPT_MANAGER_ENDPOINT="your-minio-endpoint"`}
                  </pre>
                </div>
              </>
            ) : (
              <p className="text-zinc-500">No token available</p>
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
              <label className="text-sm font-medium text-zinc-300">
                Items per page
              </label>
              <select className="flex h-10 w-full max-w-xs rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="12">12</option>
                <option value="24">24</option>
                <option value="48">48</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">
                Default view
              </label>
              <select className="flex h-10 w-full max-w-xs rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="grid">Grid</option>
                <option value="list">List</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data Sync</CardTitle>
            <CardDescription>
              Configure data synchronization with MinIO storage
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">
                MinIO Endpoint
              </label>
              <Input
                type="url"
                placeholder="http://localhost:9000"
                className="max-w-md"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">
                Bucket Name
              </label>
              <Input
                type="text"
                placeholder="prompts"
                className="max-w-md"
              />
            </div>
            <div className="flex items-center gap-4">
              <Button variant="outline">Test Connection</Button>
              <Button>Sync Now</Button>
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
              <label className="text-sm font-medium text-zinc-300">Theme</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="theme"
                    value="dark"
                    defaultChecked
                    className="h-4 w-4 border-zinc-700 bg-zinc-900 text-blue-500 focus:ring-blue-500"
                  />
                  <span className="text-sm text-zinc-300">Dark</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="theme"
                    value="light"
                    className="h-4 w-4 border-zinc-700 bg-zinc-900 text-blue-500 focus:ring-blue-500"
                  />
                  <span className="text-sm text-zinc-300">Light</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="theme"
                    value="system"
                    className="h-4 w-4 border-zinc-700 bg-zinc-900 text-blue-500 focus:ring-blue-500"
                  />
                  <span className="text-sm text-zinc-300">System</span>
                </label>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
