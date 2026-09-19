import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getSession } from "@/lib/auth/session";
import { getCustomerSession } from "@/lib/auth/customer-session";
import { can } from "@/lib/permissions";
import { createDownloadUrl } from "@/modules/media/storage";

/** Stable media references resolve at request time, never persist expiring signed URLs. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return new NextResponse(null, { status: 404 });
  const asset = await prisma.mediaAsset.findFirst({
    where: { id, deletedAt: null, uploadStatus: "READY" },
  });
  if (!asset) return new NextResponse(null, { status: 404 });
  if (asset.visibility !== "PUBLIC") {
    const session = await getSession();
    const customer = session ? null : await getCustomerSession();
    if (
      !(
        session?.businessId === asset.businessId &&
        (can(session, "media.manage") ||
          (asset.mimeType === "text/csv" && can(session, "courier.reconcile")))
      ) &&
      !(
        customer?.businessId === asset.businessId &&
        customer.id === asset.uploadedByCustomerId
      )
    )
      return new NextResponse(null, { status: 404 });
  }
  const signed = await createDownloadUrl({
    key: asset.objectKey,
    disposition: asset.mimeType === "text/csv" ? "attachment" : "inline",
    expiresInSeconds: 300,
  });
  return NextResponse.redirect(new URL(signed.url, _request.url), {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
