import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { getMediaAsset } from "@/modules/media/service";
import { mediaUsageDetail } from "@/modules/media/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/media/assets/[id]
 *
 * Returns a single media asset with its usage details.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    assertPermission(session, "media.manage");

    const { id } = await params;
    const [asset, usages] = await Promise.all([
      getMediaAsset(session.businessId, id),
      mediaUsageDetail(session.businessId, id),
    ]);

    return NextResponse.json({ asset, usages });
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) {
      const appError = error as { statusCode: number; message: string };
      return NextResponse.json({ error: appError.message }, { status: appError.statusCode });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
