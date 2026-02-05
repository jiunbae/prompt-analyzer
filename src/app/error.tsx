"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global Error Boundary caught:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 p-4 text-center">
      <div className="space-y-4 max-w-md">
        <h2 className="text-2xl font-bold text-zinc-100">Something went wrong!</h2>
        <p className="text-zinc-400 text-sm">
          The application encountered a server-side error. 
          {error.digest && (
            <span className="block mt-2 font-mono text-[10px] text-zinc-600">
              Digest: {error.digest}
            </span>
          )}
        </p>
        <div className="pt-4 flex gap-4 justify-center">
          <Button onClick={() => reset()} variant="default">
            Try again
          </Button>
          <Button 
            onClick={() => { window.location.href = "/login"; }} 
            variant="outline"
          >
            Go to Login
          </Button>
        </div>
        {process.env.NODE_ENV === "development" && (
          <pre className="mt-8 p-4 bg-zinc-900 border border-zinc-800 rounded text-left text-xs text-red-400 overflow-auto max-h-64">
            {error.stack}
          </pre>
        )}
      </div>
    </div>
  );
}
