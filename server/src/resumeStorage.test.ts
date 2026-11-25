import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createResumeStorage, LocalResumeStorage, S3ResumeStorage } from "./resumeStorage.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("resume storage", () => {
  it("writes, retrieves, deletes, and rejects unsafe local object keys", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "skillbridge-resumes-"));
    temporaryDirectories.push(directory);
    const storage = new LocalResumeStorage(directory);
    const content = Buffer.from("%PDF-1.7\nprivate test file");

    const key = await storage.put(content);
    expect(await storage.get(key)).toEqual(content);
    await expect(storage.get("../outside.pdf")).rejects.toThrow("Invalid stored resume key");
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
  });

  it("requires a configured bucket and encrypts S3 objects without public ACLs", async () => {
    expect(() => new S3ResumeStorage({})).toThrow("RESUME_S3_BUCKET and RESUME_S3_REGION");
    const content = Buffer.from("%PDF-1.7\nprivate test file");
    const send = vi.spyOn(S3Client.prototype, "send")
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({ Body: { transformToByteArray: async () => content } } as never)
      .mockResolvedValueOnce({} as never);
    const storage = new S3ResumeStorage({ RESUME_S3_BUCKET: "private-resumes", RESUME_S3_REGION: "us-east-1" });

    const key = await storage.put(content);
    expect(await storage.get(key)).toEqual(content);
    await storage.delete(key);

    const upload = send.mock.calls[0][0];
    expect(upload).toBeInstanceOf(PutObjectCommand);
    expect((upload as PutObjectCommand).input).toMatchObject({
      Bucket: "private-resumes",
      Key: key,
      ContentType: "application/pdf",
      ServerSideEncryption: "AES256",
    });
    expect((upload as PutObjectCommand).input).not.toHaveProperty("ACL");
    expect(send.mock.calls[1][0]).toBeInstanceOf(GetObjectCommand);
    expect(send.mock.calls[2][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it("uses the requested KMS key and refuses local storage in production", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
    const storage = new S3ResumeStorage({
      RESUME_S3_BUCKET: "private-resumes",
      RESUME_S3_REGION: "us-east-1",
      RESUME_S3_KMS_KEY_ID: "kms-key-id",
    });
    await storage.put(Buffer.from("%PDF-1.7"));

    expect((send.mock.calls[0][0] as PutObjectCommand).input).toMatchObject({
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: "kms-key-id",
    });
    expect(() => createResumeStorage({ NODE_ENV: "production" })).toThrow("Production requires RESUME_STORAGE_PROVIDER=s3");
    expect(() => createResumeStorage({ NODE_ENV: "production", RESUME_STORAGE_PROVIDER: "local" })).toThrow("Production requires RESUME_STORAGE_PROVIDER=s3");
    expect(() => new S3ResumeStorage({
      NODE_ENV: "production",
      RESUME_S3_BUCKET: "private-resumes",
      RESUME_S3_REGION: "us-east-1",
      RESUME_S3_ENDPOINT: "http://storage.internal",
    })).toThrow("RESUME_S3_ENDPOINT must use HTTPS in production");
  });

  it("treats a missing S3 key as absent but propagates permission failures", async () => {
    const send = vi.spyOn(S3Client.prototype, "send")
      .mockRejectedValueOnce({ name: "NoSuchKey" } as never)
      .mockRejectedValueOnce(Object.assign(new Error("Access denied"), { name: "AccessDenied" }) as never);
    const storage = new S3ResumeStorage({ RESUME_S3_BUCKET: "private-resumes", RESUME_S3_REGION: "us-east-1" });

    await expect(storage.get("missing.pdf")).resolves.toBeNull();
    await expect(storage.get("private.pdf")).rejects.toThrow("Access denied");
    expect(send).toHaveBeenCalledTimes(2);
  });
});
