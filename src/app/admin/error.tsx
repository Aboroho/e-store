"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui/primitives";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The server logs the full error; the browser only keeps the digest.
    console.error("Admin area error", error.digest ?? error.message);
  }, [error]);

  return (
    <Card>
      <CardContent className="space-y-4 py-10 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
          <AlertTriangle className="h-6 w-6" />
        </span>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
          <p className="text-sm text-slate-500">
            The action could not be completed. The error has been logged with a reference you can quote to support.
          </p>
          {error.digest ? <p className="font-mono text-xs text-slate-400">Reference: {error.digest}</p> : null}
        </div>
        <Button onClick={reset} variant="outline">
          <RotateCcw className="mr-2 h-4 w-4" /> Try again
        </Button>
      </CardContent>
    </Card>
  );
}
