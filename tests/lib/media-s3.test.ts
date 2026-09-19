import { afterEach, describe, expect, it, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
vi.mock("@/lib/env", () => ({
  storageDriver: () => "s3",
  env: () => ({
    S3_BUCKET: "test-bucket",
    S3_REGION: "us-east-1",
    S3_ENDPOINT: "https://objects.example.test",
    S3_FORCE_PATH_STYLE: true,
    S3_ACCESS_KEY_ID: "test-key",
    S3_SECRET_ACCESS_KEY: "test-secret",
    S3_PRESIGN_EXPIRES_SECONDS: 900,
  }),
}));
import { createUploadTarget, headObject } from "@/modules/media/storage";

describe("S3-compatible media adapter", () => {
  afterEach(() => vi.restoreAllMocks());
  it("signs immutable PUTs to the configured S3 endpoint", async () => {
    const target = await createUploadTarget({
      key: "businesses/id/asset.png",
      contentType: "image/png",
      sizeBytes: 100,
    });
    const url = new URL(target.url);
    expect(url.origin).toBe("https://objects.example.test");
    expect(url.pathname).toBe("/test-bucket/businesses/id/asset.png");
    expect(target.headers["if-none-match"]).toBe("*");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain(
      "if-none-match",
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain(
      "content-length",
    );
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(target.method).toBe("PUT");
    expect(target.url).not.toContain("test-secret");
  });
  it("does not mistake a storage outage or denied access for a missing object", async () => {
    const spy = vi.spyOn(S3Client.prototype, "send");
    spy.mockRejectedValueOnce({ $metadata: { httpStatusCode: 403 } });
    await expect(headObject("test.png")).rejects.toMatchObject({
      $metadata: { httpStatusCode: 403 },
    });
    spy.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    expect((await headObject("test.png")).exists).toBe(false);
  });
});
