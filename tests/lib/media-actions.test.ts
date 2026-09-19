import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  customer: vi.fn(),
  list: vi.fn(),
  folders: vi.fn(),
  request: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/auth/customer-session", () => ({
  getCustomerSession: mocks.customer,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/media/service", () => ({
  listMedia: mocks.list,
  listMediaFolders: mocks.folders,
  requestUpload: mocks.request,
  confirmUpload: mocks.confirm,
}));
vi.mock("@/modules/reviews/service", () => ({
  reviewImageLimits: async () => ({ maxImages: 3, maxBytes: 1024 }),
}));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  RateLimits: { reviewSubmit: {} },
}));
import {
  browseMediaAction,
  requestUploadAction,
  confirmUploadAction,
  mediaPickerContextAction,
} from "@/modules/media/actions";

describe("server-side media authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({
      id: "staff",
      businessId: "business",
      email: "staff@example.test",
      permissions: [],
    });
    mocks.list.mockResolvedValue({ rows: [], total: 0 });
    mocks.folders.mockResolvedValue([]);
  });
  it("refuses library browsing without a relevant permission", async () => {
    await expect(browseMediaAction({})).rejects.toThrow(/browse/);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("lets product editors browse public assets, but not upload without media.manage", async () => {
    mocks.session.mockResolvedValue({
      id: "staff",
      businessId: "business",
      permissions: ["product.update"],
    });
    await browseMediaAction({ mimeGroup: "image" });
    expect(mocks.list).toHaveBeenCalledWith(
      "business",
      expect.objectContaining({ visibility: "PUBLIC", mimeGroup: "image" }),
    );
    expect((await mediaPickerContextAction()).canUpload).toBe(false);
    expect(
      (
        await requestUploadAction({
          fileName: "x.png",
          mimeType: "image/png",
          sizeBytes: 10,
        })
      ).ok,
    ).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("permission-checks confirmation, not just reservation", async () => {
    expect((await confirmUploadAction({ assetId: "anything" })).ok).toBe(false);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("requires an authenticated customer and never exposes the staff library to them", async () => {
    mocks.customer.mockResolvedValue(null);
    await expect(browseMediaAction({ audience: "customer" })).rejects.toThrow(
      /Sign in/,
    );
    mocks.customer.mockResolvedValue({
      id: "customer",
      businessId: "customer-business",
    });
    await browseMediaAction({ audience: "customer", mimeGroup: "all" });
    expect(mocks.list).toHaveBeenCalledWith(
      "customer-business",
      expect.objectContaining({ customerId: "customer", mimeGroup: "image" }),
    );
    expect(mocks.session).not.toHaveBeenCalled();
    expect((await mediaPickerContextAction("customer")).folders).toEqual([]);
  });
  it("enforces customer image/size rules on the server", async () => {
    mocks.customer.mockResolvedValue({
      id: "customer",
      businessId: "customer-business",
    });
    expect(
      (
        await requestUploadAction({
          audience: "customer",
          fileName: "x.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await requestUploadAction({
          audience: "customer",
          fileName: "x.png",
          mimeType: "image/png",
          sizeBytes: 2048,
        })
      ).ok,
    ).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
