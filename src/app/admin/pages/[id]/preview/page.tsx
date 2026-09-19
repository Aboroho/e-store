import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { Alert, PageHeader, buttonVariants } from "@/components/ui/primitives";
import { PageRenderer } from "@/components/page-builder/block-renderer";
import { previewPage } from "@/modules/page-builder/service";
import { storefrontContextById } from "@/modules/storefront/queries";
import { StorefrontChrome } from "@/components/storefront/chrome";
import { AppError } from "@/lib/errors";

export const metadata: Metadata = { title: "Page preview" };
export const dynamic = "force-dynamic";

/**
 * Draft preview.
 *
 * Renders the working version (draft, or the published one when there is no draft) with
 * the real storefront renderer, so what is reviewed here is exactly what publishing
 * produces.
 */
export default async function PagePreview({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "page.manage");
  const { id } = await params;

  let preview;
  try {
    preview = await previewPage(session.businessId, id);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }

  const storefront = await storefrontContextById(session.businessId, preview.page.id ? null : null);
  if (!storefront) {
    return (
      <div className="space-y-4">
        <PageHeader title="Preview" description={preview.page.title} />
        <Alert variant="warning">Create a storefront first — the preview renders inside your storefront theme.</Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Preview"
        description="Rendered by the same code path the public storefront uses. Draft content is never served publicly."
        actions={
          <div className="flex gap-2">
            <Link href={`/admin/pages/${preview.page.id}/builder`} className={buttonVariants({ size: "sm" })}>
              Back to builder
            </Link>
            <Link href={`/admin/pages/${preview.page.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Settings
            </Link>
          </div>
        }
      />

      <div className="overflow-hidden rounded-xl border bg-white">
        <StorefrontChrome storefront={storefront} preview>
          <PageRenderer document={preview.document} storefront={storefront} />
        </StorefrontChrome>
      </div>
    </div>
  );
}
