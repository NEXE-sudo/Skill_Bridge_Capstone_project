import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ResumeStorage {
  put(content: Buffer): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

function assertKey(key: string) {
  if (!/^[\w-]{1,128}\.pdf$/.test(key)) throw new Error("Invalid stored resume key");
}

export class LocalResumeStorage implements ResumeStorage {
  constructor(private readonly directory = path.resolve(process.cwd(), "uploads")) {}

  async put(content: Buffer) {
    await mkdir(this.directory, { recursive: true });
    const key = `${randomUUID()}.pdf`;
    await writeFile(path.join(this.directory, key), content, { flag: "wx", mode: 0o600 });
    return key;
  }

  async get(key: string) {
    assertKey(key);
    try {
      return await readFile(path.join(this.directory, key));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string) {
    assertKey(key);
    await rm(path.join(this.directory, key), { force: true });
  }
}

export class S3ResumeStorage implements ResumeStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly encryption: "AES256" | "aws:kms";

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.bucket = env.RESUME_S3_BUCKET ?? "";
    const region = env.RESUME_S3_REGION ?? "";
    if (!this.bucket || !region) throw new Error("RESUME_S3_BUCKET and RESUME_S3_REGION are required for S3 resume storage");
    const endpoint = env.RESUME_S3_ENDPOINT;
    if (endpoint && env.NODE_ENV === "production" && new URL(endpoint).protocol !== "https:") {
      throw new Error("RESUME_S3_ENDPOINT must use HTTPS in production");
    }
    this.client = new S3Client({
      region,
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: env.RESUME_S3_FORCE_PATH_STYLE === "true",
    });
    this.encryption = env.RESUME_S3_KMS_KEY_ID ? "aws:kms" : "AES256";
    this.kmsKeyId = env.RESUME_S3_KMS_KEY_ID;
  }

  private readonly kmsKeyId: string | undefined;

  async put(content: Buffer) {
    const key = `${randomUUID()}.pdf`;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: content,
      ContentType: "application/pdf",
      ServerSideEncryption: this.encryption,
      ...(this.kmsKeyId ? { SSEKMSKeyId: this.kmsKeyId } : {}),
    }));
    return key;
  }

  async get(key: string) {
    assertKey(key);
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body) return null;
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      if (typeof error === "object" && error !== null && "name" in error && (error.name === "NoSuchKey" || error.name === "NotFound")) return null;
      throw error;
    }
  }

  async delete(key: string) {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function createResumeStorage(env: NodeJS.ProcessEnv = process.env): ResumeStorage {
  const provider = env.RESUME_STORAGE_PROVIDER ?? (env.NODE_ENV === "production" ? "" : "local");
  if (provider === "s3") return new S3ResumeStorage(env);
  if (provider === "local" && env.NODE_ENV !== "production") return new LocalResumeStorage(env.RESUME_LOCAL_DIRECTORY);
  throw new Error("Production requires RESUME_STORAGE_PROVIDER=s3; local storage is development-only");
}
