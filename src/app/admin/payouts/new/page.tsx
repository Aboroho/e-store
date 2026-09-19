import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { listResellers } from "@/modules/resellers/queries";
import { eligiblePayoutEntries } from "@/modules/resellers/payouts";
import { PayoutForm } from "@/components/forms/reseller-forms";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "New payout" };
export const dynamic = "force-dynamic";

export default async function NewPayoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  assertPermission(session, "reseller.payout");
  const params = await searchParams;
  const requested = Array.isArray(params.resellerId) ? params.resellerId[0] : params.resellerId;

  const { rows: resellers } = await listResellers(session.businessId, { pageSize: 100, status: "ACTIVE" });
  const payableResellers = resellers.filter((reseller) => reseller.balance.eligiblePaisa > 0);
  const requestedReseller = requested ? resellers.find((reseller) => reseller.id === requested) : undefined;
  const toRender = requestedReseller ? [requestedReseller] : payableResellers;

  const cards = await Promise.all(
    toRender.map(async (reseller) => {
      const eligible = await eligiblePayoutEntries(session.businessId, reseller.id);
      const belowMinimum = eligible.totalPaisa < reseller.minimumPayoutPaisa;

      return (
        <Card key={reseller.id}>
          <CardHeader>
            <CardTitle>
              {reseller.name} · {reseller.code}
            </CardTitle>
            <CardDescription>
              {formatPaisa(eligible.totalPaisa)} payable across {eligible.entries.length} entr{eligible.entries.length === 1 ? "y" : "ies"}
              {belowMinimum ? ` — below the minimum of ${formatPaisa(reseller.minimumPayoutPaisa)}` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {belowMinimum ? (
              <Alert variant="warning">
                This reseller&apos;s payable balance is under their minimum payout. Wait for more settled earnings, or lower the minimum in the reseller profile.
              </Alert>
            ) : (
              <PayoutForm
                resellerId={reseller.id}
                eligiblePaisa={eligible.totalPaisa}
                minimumPayoutPaisa={reseller.minimumPayoutPaisa}
                entries={eligible.entries.map((entry) => ({
                  id: entry.id,
                  amountPaisa: entry.direction === "CREDIT" ? entry.amountPaisa : -entry.amountPaisa,
                  label: `${entry.createdAt.toISOString().slice(0, 10)} · ${entry.type.replace(/_/g, " ").toLowerCase()} · ${entry.description}`,
                }))}
              />
            )}
          </CardContent>
        </Card>
      );
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create a payout"
        description="Pick from the entries that are payable right now. The server recomputes the amount from the selected entries — it can never exceed the payable balance."
        actions={
          <Link href="/admin/payouts" className="text-sm font-medium text-indigo-600 hover:underline">
            ← All payouts
          </Link>
        }
      />

      {resellers.length === 0 ? (
        <EmptyState title="No active resellers" description="Create a reseller before paying anyone." />
      ) : toRender.length === 0 ? (
        <EmptyState
          title="Nothing is payable yet"
          description="Earnings become payable only after the courier COD settlement that carried the cash has been reconciled."
        />
      ) : (
        cards
      )}

      <Alert variant="info">
        A payout starts as <strong>pending approval</strong>. Entries move to paid only when someone records the transaction reference — that is the point of no
        return, and it is audited.
      </Alert>
    </div>
  );
}
