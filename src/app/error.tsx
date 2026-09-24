"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui/primitives";

/**
 * Root error boundary.
 *
 * Errors thrown from `app/admin/layout.tsx` skip the admin `error.tsx` (that
 * file only wraps pages). An unauthenticated throw used to surface as an
 * uncaught overlay; send those visitors to sign-in instead.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const unauthenticated = /sign in|unauthenticated|authentication is required/i.test(error.message);

  useEffect(() => {
    if (unauthenticated) {
      router.replace("/login?sessionExpired=1");
    }
  }, [unauthenticated, router]);

  if (unauthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-slate-600">Redirecting to sign in…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="max-w-md">
        <CardContent className="space-y-4 py-10 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
            <p className="text-sm text-slate-500">The page could not be loaded. Try again, or sign in if your session has expired.</p>
            {error.digest ? <p className="font-mono text-xs text-slate-400">Reference: {error.digest}</p> : null}
          </div>
          <Button onClick={reset} variant="outline">
            <RotateCcw className="mr-2 h-4 w-4" /> Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
