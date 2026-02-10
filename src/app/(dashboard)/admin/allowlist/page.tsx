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
import { Input } from "@/components/ui/input";

interface AllowedEmail {
  id: string;
  email: string;
  addedAt: string;
  addedBy: {
    id: string;
    name: string | null;
    email: string;
  } | null;
}

export default function AllowlistPage() {
  const { user, loading: userLoading } = useUser();
  const router = useRouter();
  const [emails, setEmails] = useState<AllowedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchEmails = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/admin/allowlist");

      if (res.ok) {
        const data = await res.json();
        setEmails(data.allowedEmails || []);
      } else if (res.status === 403) {
        router.push("/sessions");
      } else {
        const data = await res.json();
        setError(data.error || "Failed to fetch allowlist");
      }
    } catch {
      setError("Failed to fetch allowlist");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!userLoading) {
      if (!user?.isAdmin) {
        router.push("/sessions");
      } else {
        fetchEmails();
      }
    }
  }, [user, userLoading, router, fetchEmails]);

  const handleAddEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;

    setAdding(true);
    setError("");

    try {
      const res = await fetch("/api/admin/allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim().toLowerCase() }),
      });

      if (res.ok) {
        setNewEmail("");
        fetchEmails();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to add email");
      }
    } catch {
      setError("Failed to add email");
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteEmail = async (id: string) => {
    setDeletingId(id);
    setError("");

    try {
      const res = await fetch(`/api/admin/allowlist?id=${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchEmails();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to delete email");
      }
    } catch {
      setError("Failed to delete email");
    } finally {
      setDeletingId(null);
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
        <h1 className="text-2xl font-semibold text-foreground">Email Allowlist</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage which email addresses can register for an account
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add Email</CardTitle>
          <CardDescription>
            Add an email address to allow registration
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddEmail} className="flex gap-3">
            <Input
              type="email"
              placeholder="user@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="max-w-md"
              required
            />
            <Button type="submit" disabled={adding || !newEmail.trim()}>
              {adding ? "Adding..." : "Add Email"}
            </Button>
          </form>
          {error && (
            <p className="text-red-400 text-sm mt-3">{error}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allowed Emails</CardTitle>
          <CardDescription>
            {emails.length} email{emails.length !== 1 ? "s" : ""} in the allowlist
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : emails.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No emails in the allowlist yet. Add one above to get started.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {emails.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <p className="text-foreground font-medium">{item.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Added {new Date(item.addedAt).toLocaleDateString()}
                      {item.addedBy && ` by ${item.addedBy.name || item.addedBy.email}`}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteEmail(item.id)}
                    disabled={deletingId === item.id}
                    className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                  >
                    {deletingId === item.id ? (
                      <span className="animate-spin h-4 w-4 border-2 border-red-400 border-t-transparent rounded-full" />
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
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
