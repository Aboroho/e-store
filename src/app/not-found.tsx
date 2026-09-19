import Link from "next/link";
import { Compass } from "lucide-react";
import { Card, CardContent, buttonVariants } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 py-10 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <Compass className="h-6 w-6" />
          </span>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-slate-900">Page not found</h1>
            <p className="text-sm text-slate-500">
              The page you were looking for does not exist, or you do not have access to it.
            </p>
          </div>
          <Link href="/admin" className={buttonVariants({ variant: "default" })}>
            Back to the dashboard
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
