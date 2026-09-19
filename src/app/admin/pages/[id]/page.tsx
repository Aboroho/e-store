import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db/client";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, PageHeader, buttonVariants } from "@/components/ui/primitives";
import { PageSettingsForm, PublishControls, VersionList } from "@/components/forms/page-forms";
import { getPage, pageVersions } from "@/modules/page-builder/service";
import { formatDateTime } from "@/lib/utils";
import { AppError } from "@/lib/errors";

export const metadata: Metadata = { title: "Page settings" };
export const dynamic = "force-dynamic";

export default async function PageDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "page.manage");
  const { id } = await params;

  let page;
  try {
    page = await getPage(session.businessId, id);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }

  const [storefronts, versions] = await Promise.all([
    prisma.storefront.findMany({ where: { businessId: session.businessId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, slug: true } }),
    pageVersions(session.businessId, id),
  ]);

  const draftBlocks = page.draftVersionId ? page.versions.find((version) => version.id === page.draftVersionId)?.blocksCount ?? 0 : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={page.title}
        description={`/${page.slug} · ${page.storefront?.name ?? "all storefronts"} · version ${page.currentVersion}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/admin/pages/${page.id}/builder`} className={buttonVariants({ size: "sm" })}>
              Open builder
            </Link>
            <Link href={`/admin/pages/${page.id}/preview`} className={buttonVariants({ variant: "outline", size: "sm" })} target="_blank">
              Preview
            </Link>
          </div>
        }
      />

      {page.status === "PUBLISHED" ? null : <Alert variant="warning">This page is not published, so the storefront does not serve it yet.</Alert>}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Page settings</CardTitle>
            </CardHeader>
            <CardContent>
              <PageSettingsForm
                page={{
                  id: page.id,
                  title: page.title,
                  slug: page.slug,
                  type: page.type,
                  template: page.template,
                  storefrontId: page.storefrontId,
                  status: page.status,
                  isHomepage: page.isHomepage,
                  seoTitle: page.seoTitle,
                  seoDescription: page.seoDescription,
                  seoKeywords: page.seoKeywords,
                  canonicalUrl: page.canonicalUrl,
                  robots: page.robots ?? "index,follow",
                }}
                storefronts={storefronts}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Version history</CardTitle>
            </CardHeader>
            <CardContent>
              <VersionList
                pageId={page.id}
                versions={versions.map((version) => ({
                  id: version.id,
                  version: version.version,
                  status: version.status,
                  blocksCount: version.blocksCount,
                  note: version.note,
                  createdAt: version.createdAt.toISOString(),
                  isPublished: version.isPublished,
                  isCurrentDraft: version.isCurrentDraft,
                }))}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="flex items-center gap-2">
                <Badge variant={page.status === "PUBLISHED" ? "success" : "warning"}>{page.status.toLowerCase()}</Badge>
                <span className="text-slate-500">v{page.currentVersion}</span>
              </p>
              <dl className="space-y-1 text-xs text-slate-600">
                <div className="flex justify-between">
                  <dt>Draft blocks</dt>
                  <dd>{draftBlocks}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Published</dt>
                  <dd>{page.publishedAt ? formatDateTime(page.publishedAt) : "never"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Updated</dt>
                  <dd>{formatDateTime(page.updatedAt)}</dd>
                </div>
              </dl>
              <PublishControls pageId={page.id} canPublish={page.status === "PUBLISHED"} hasDraft={Boolean(page.draftVersionId)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Where used</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">
              {page.isHomepage ? (
                <p>This page is the homepage of {page.storefront?.name ?? "the default storefront"}.</p>
              ) : (
                <p>
                  Reachable at <span className="font-mono text-xs">/pages/{page.slug}</span> and from any navigation menu that links to it.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
