import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const actions = vi.hoisted(() => ({ request: vi.fn(), confirm: vi.fn() }));
vi.mock("@/modules/media/actions", () => ({
  requestUploadAction: actions.request,
  confirmUploadAction: actions.confirm,
}));
import { uploadMedia } from "@/modules/media/upload-client";

class UploadRequest {
  static sends = 0;
  static failures = 0;
  status = 200;
  timeout = 0;
  upload: {
    onprogress?: (event: {
      lengthComputable: boolean;
      loaded: number;
      total: number;
    }) => void;
  } = {};
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  open() {}
  setRequestHeader() {}
  send() {
    UploadRequest.sends++;
    if (UploadRequest.failures-- > 0) {
      this.onerror?.();
      return;
    }
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    this.onload?.();
  }
}
describe("one shared browser upload workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    UploadRequest.sends = 0;
    UploadRequest.failures = 0;
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    actions.request.mockResolvedValue({
      ok: true,
      assetId: "asset",
      uploadUrl: "/signed-put",
      method: "PUT",
      headers: {},
      reused: false,
    });
    actions.confirm.mockResolvedValue({ ok: true });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("reports progress and returns only the confirmed asset ID", async () => {
    const progress = vi.fn();
    expect(
      await uploadMedia(
        new File(["hello,world"], "file.csv", { type: "text/plain" }),
        { visibility: "PRIVATE", onProgress: progress },
      ),
    ).toBe("asset");
    expect(actions.request).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: "text/csv",
        visibility: "PRIVATE",
        checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(progress).toHaveBeenCalledWith(45);
    expect(progress).toHaveBeenLastCalledWith(100);
    expect(actions.confirm).toHaveBeenCalledOnce();
  });
  it("retries a network error using the same reservation", async () => {
    UploadRequest.failures = 1;
    await uploadMedia(
      new File(["data"], "file.pdf", { type: "application/pdf" }),
    );
    expect(UploadRequest.sends).toBe(2);
    expect(actions.request).toHaveBeenCalledOnce();
    expect(actions.confirm).toHaveBeenCalledOnce();
  });
  it("does not PUT or confirm when an existing asset is reused", async () => {
    actions.request.mockResolvedValue({
      ok: true,
      assetId: "existing",
      reused: true,
      uploadUrl: null,
    });
    expect(
      await uploadMedia(
        new File(["data"], "file.pdf", { type: "application/pdf" }),
      ),
    ).toBe("existing");
    expect(UploadRequest.sends).toBe(0);
    expect(actions.confirm).not.toHaveBeenCalled();
  });
  it("surfaces server authorization and validation failures", async () => {
    actions.request.mockResolvedValue({
      ok: false,
      message: "Missing upload permission",
    });
    await expect(uploadMedia(new File(["data"], "file.pdf"))).rejects.toThrow(
      /permission/,
    );
    expect(UploadRequest.sends).toBe(0);
    actions.request.mockResolvedValue({
      ok: true,
      assetId: "asset",
      uploadUrl: "/signed-put",
      method: "PUT",
      headers: {},
      reused: false,
    });
    actions.confirm.mockResolvedValue({
      ok: false,
      message: "File contents do not match",
    });
    await expect(uploadMedia(new File(["data"], "file.pdf"))).rejects.toThrow(
      /contents/,
    );
  });
});
