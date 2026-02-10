"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PromptCard } from "@/components/prompt-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/skeleton";

interface Tag {
  id: string;
  name: string;
  color?: string | null;
}

interface Prompt {
  id: string;
  timestamp: Date;
  projectName?: string | null;
  preview: string;
  promptType: "user_input" | "task_notification" | "system" | "user" | "assistant";
  tokenCount: number;
  tags?: Tag[];
}

interface PromptListProps {
  prompts: Prompt[];
  isLoading?: boolean;
  totalCount?: number;
  currentPage?: number;
  pageSize?: number;
}

export function PromptList({
  prompts,
  isLoading = false,
  totalCount = 0,
  currentPage = 1,
  pageSize = 12,
}: PromptListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<"date" | "tokens">("date");
  const [searchQuery, setSearchQuery] = useState("");

  const totalPages = Math.ceil(totalCount / pageSize);

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", page.toString());
    router.push(`/prompts?${params.toString()}`);
  };

  const handleSortChange = (sort: "date" | "tokens") => {
    setSortBy(sort);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    if (searchQuery) {
      params.set("search", searchQuery);
    } else {
      params.delete("search");
    }
    params.delete("page");
    router.push(`/prompts?${params.toString()}`);
  };

  if (isLoading) {
    return <SkeletonList count={6} />;
  }

  if (prompts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <svg
          className="h-16 w-16 text-zinc-600 mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <title>No Prompts Icon</title>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
          />
        </svg>
        <h3 className="text-lg font-medium text-zinc-300 mb-2">
          No prompts found
        </h3>
        <p className="text-sm text-zinc-500 max-w-sm">
          Start capturing your prompts to see your history appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-end">
        <div className="flex gap-2">
          <div className="flex rounded-md border border-zinc-700">
            <button
              type="button"
              onClick={() => handleSortChange("date")}
              className={`px-3 py-1.5 text-sm ${
                sortBy === "date"
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              Date
            </button>
            <button
              type="button"
              onClick={() => handleSortChange("tokens")}
              className={`px-3 py-1.5 text-sm border-l border-zinc-700 ${
                sortBy === "tokens"
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              Tokens
            </button>
          </div>

          <div className="flex rounded-md border border-zinc-700">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`px-2 py-1.5 ${
                viewMode === "grid"
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
              aria-label="Grid view"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <title>Grid View</title>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`px-2 py-1.5 border-l border-zinc-700 ${
                viewMode === "list"
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
              aria-label="List view"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <title>List View</title>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div
        className={
          viewMode === "grid"
            ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            : "flex flex-col gap-3"
        }
      >
        {prompts.map((prompt) => (
          <PromptCard key={prompt.id} {...prompt} />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-zinc-800">
          <span className="text-sm text-zinc-500">
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
