import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db/client";
import { PageHeader, buttonVariants } from "@/components/ui/primitives";
import { PageBuilder } from "@/components/page-builder/builder";
import { pageVersions, workingDocument } from "@/modules/page-builder/service";
import { parsePageDocument } from "@/modules/page-builder/schema";
import { AppError } from "@/lib/errors";

export const metadata: Metadata = { title: "Page builder" };
export const dynamic = "force-dynamic";

export default async function PageBuilderScreen({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "page.manage");
  const { id } = await params;
  const query = await searchParams;
  const versionId = Array.isArray(query.version) ? query.version[0] : query.version;

  let working;
  try {
    working = await workingDocument(session.businessId, id);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }

  const version = versionId ? working.page.versions.find((candidate) => candidate.id === versionId) : undefined;
  const document = version ? parsePageDocument(version.document) : working.document;

  const [versions, storefronts, products, categories] = await Promise.all([
    pageVersions(session.businessId, id),
    prisma.storefront.findMany({ where: { businessId: session.businessId }, select: { id: true, name: true } }),
    prisma.product.findMany({ where: { businessId: session.businessId, deletedAt: null }, orderBy: { name: "asc" }, take: 300, select: { id: true, name: true } }),
    prisma.category.findMany({ where: { businessId: session.businessId, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Builder · ${working.page.title}`}
        description={
          version
            ? `Editing v${version.version} (${version.status.toLowerCase()}) — saving creates a new draft`
            : working.isDraft
              ? "Editing the current draft"
              : "Editing the published layout — saving creates a new draft"
        }
        actions={
          <Link href={`/admin/pages/${working.page.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Page settings
          </Link>
        }
      />

      <PageBuilder
        page={{
          id: working.page.id,
          title: working.page.title,
          slug: working.page.slug,
          status: working.page.status,
          isHomepage: working.page.isHomepage,
          storefrontId: working.page.storefrontId,
          seoTitle: working.page.seoTitle,
          seoDescription: working.page.seoDescription,
          updatedAt: working.page.updatedAt.toISOString(),
          publishedAt: working.page.publishedAt ? working.page.publishedAt.toISOString() : null,
        }}
        document={document}
        versions={versions.map((entry) => ({
          id: entry.id,
          version: entry.version,
          status: entry.status,
          note: entry.note,
          createdAt: entry.createdAt.toISOString(),
          isCurrentDraft: entry.isCurrentDraft,
          isPublished: entry.isPublished,
        }))}
        storefronts={storefronts}
        products={products}
        categories={categories}
        previewUrl={`/admin/pages/${working.page.id}/preview`}
      />
    </div>
  );
}
