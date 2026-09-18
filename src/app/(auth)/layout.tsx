import { Card, CardContent } from "@/components/ui/primitives";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-100 via-white to-brand-50 px-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white shadow-sm">
          ES
        </span>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">E-Store platform</p>
          <h1 className="text-lg font-semibold text-slate-900">Business management</h1>
        </div>
      </div>
      {children}
      <Card className="mt-6 w-full max-w-md border-dashed">
        <CardContent className="p-4 text-center text-xs text-slate-500">
          Need help? Contact your platform administrator. Sessions expire automatically and failed sign-in attempts are
          locked out.
        </CardContent>
      </Card>
    </main>
  );
}
