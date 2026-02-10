"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/contexts/user-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface UserInfo {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateStr));
}

function formatDateTime(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateStr));
}

export default function AdminUsersPage() {
  const { user, loading: userLoading } = useUser();
  const router = useRouter();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/admin/users");

      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      } else if (res.status === 403) {
        router.push("/prompts");
      } else {
        const data = await res.json();
        setError(data.error || "Failed to fetch users");
      }
    } catch {
      setError("Failed to fetch users");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!userLoading) {
      if (!user?.isAdmin) {
        router.push("/prompts");
      } else {
        fetchUsers();
      }
    }
  }, [user, userLoading, router, fetchUsers]);

  const handleToggleAdmin = async (userId: string, currentIsAdmin: boolean) => {
    setTogglingId(userId);
    setError("");

    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, isAdmin: !currentIsAdmin }),
      });

      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId ? { ...u, isAdmin: !currentIsAdmin } : u
          )
        );
      } else {
        const data = await res.json();
        setError(data.error || "Failed to update user");
      }
    } catch {
      setError("Failed to update user");
    } finally {
      setTogglingId(null);
    }
  };

  if (userLoading || !user?.isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Users</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage user accounts and permissions
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <CardDescription>
            {users.length} registered user{users.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No users found.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {/* Header */}
              <div className="hidden md:grid md:grid-cols-[1fr_1fr_100px_120px_120px_80px] gap-4 py-2 text-xs text-muted-foreground font-medium">
                <span>Email</span>
                <span>Name</span>
                <span>Role</span>
                <span>Created</span>
                <span>Last Login</span>
                <span></span>
              </div>
              {users.map((u) => {
                const isSelf = u.id === user?.id;
                return (
                  <div
                    key={u.id}
                    className="flex flex-col md:grid md:grid-cols-[1fr_1fr_100px_120px_120px_80px] gap-2 md:gap-4 py-4 md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="text-foreground text-sm truncate">
                        {u.email}
                        {isSelf && (
                          <span className="text-xs text-muted-foreground ml-2">(you)</span>
                        )}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-muted-foreground text-sm truncate">
                        {u.name || "—"}
                      </p>
                    </div>
                    <div>
                      {u.isAdmin ? (
                        <Badge variant="default" className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30">
                          Admin
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">User</span>
                      )}
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(u.createdAt)}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">
                        {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}
                      </span>
                    </div>
                    <div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleAdmin(u.id, u.isAdmin)}
                        disabled={isSelf || togglingId === u.id}
                        className={
                          u.isAdmin
                            ? "text-red-400 hover:text-red-300 hover:bg-red-900/20 text-xs"
                            : "text-indigo-400 hover:text-indigo-300 hover:bg-indigo-900/20 text-xs"
                        }
                        title={isSelf ? "Cannot change your own role" : undefined}
                      >
                        {togglingId === u.id ? (
                          <span className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                        ) : u.isAdmin ? (
                          "Revoke"
                        ) : (
                          "Grant"
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
