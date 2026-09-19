import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/primitives";
import { listStorefrontSummaries } from "@/modules/storefront/queries";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Storefronts" };
export const dynamic = "force-dynamic";

export default async function StorefrontsPage() {
  const session = await requireSession();
  assertPermission(session, "storefront.manage");

  const storefronts = await listStorefrontSummaries(session.businessId);
  const previewHost = env().APP_URL.replace(/^https?:\/\//, "");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Storefronts"
        description="One catalogue and one inventory, many storefronts. Each storefront has its own domain, theme, navigation and pages — but never its own stock."
      />

      {storefronts.length === 0 ? (
        <EmptyState title="No storefronts yet" description="Create one with the seed script or the database console; the storefront module serves the default one at the root path." />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">All storefronts</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Domains</TableHead>
                  <TableHead>Pages</TableHead>
                  <TableHead>Reviews</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {storefronts.map((storefront) => (
                  <TableRow key={storefront.id}>
                    <TableCell className="font-medium">
                      {storefront.name}
                      {storefront.isDefault ? <Badge variant="brand" className="ml-2">default</Badge> : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{storefront.slug}</TableCell>
                    <TableCell>
                      <Badge variant={storefront.status === "ACTIVE" ? "success" : "warning"}>{storefront.status.toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell>{storefront.domainCount}</TableCell>
                    <TableCell>{storefront.pageCount}</TableCell>
                    <TableCell>{storefront.reviewCount}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/admin/storefronts/${storefront.id}`} className="text-sm text-indigo-600 hover:underline">
                        Manage
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How domains resolve</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-600">
          <p>
            A request is matched against the registered domains first, then against the storefront slug, and finally falls back to the default active
            storefront. No hostname is hard-coded — the same build serves <span className="font-mono text-xs">{previewHost}</span>, a staging domain and
            your production domain.
          </p>
          <p>
            Add a domain on the storefront screen, point its DNS A/CNAME record at the server, and mark it verified once the certificate is in place.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
