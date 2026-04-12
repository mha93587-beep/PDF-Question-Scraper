import { randomUUID } from "crypto";
import { Readable } from "stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type B2Config = {
  bucket: string;
  endpoint: string;
  region: string;
  keyId: string;
  applicationKey: string;
};

export class B2ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "B2ObjectNotFoundError";
    Object.setPrototypeOf(this, B2ObjectNotFoundError.prototype);
  }
}

export class B2StorageService {
  private getConfig(): B2Config {
    const bucket = process.env.B2_BUCKET?.trim();
    const keyId = process.env.B2_KEY_ID?.trim();
    const applicationKey = process.env.B2_APPLICATION_KEY?.trim();
    const configuredRegion = process.env.B2_REGION?.trim();
    const configuredEndpoint = process.env.B2_ENDPOINT?.trim();
    const endpoint = normalizeEndpoint(configuredEndpoint || configuredRegion);
    const region = normalizeRegion(configuredRegion || configuredEndpoint);

    const missing = [
      !bucket && "B2_BUCKET",
      !keyId && "B2_KEY_ID",
      !applicationKey && "B2_APPLICATION_KEY",
      !endpoint && "B2_ENDPOINT or B2_REGION",
      !region && !process.env.B2_ENDPOINT && "B2_REGION",
    ].filter(Boolean);

    if (missing.length > 0) {
      throw new Error(`Backblaze B2 storage is not configured. Missing: ${missing.join(", ")}`);
    }

    return {
      bucket,
      keyId,
      applicationKey,
      region,
      endpoint,
    };
  }

  private getClient(config = this.getConfig()): S3Client {
    return new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.keyId,
        secretAccessKey: config.applicationKey,
      },
    });
  }

  async getUploadUrl({ fileName, contentType }: { fileName: string; contentType: string }) {
    const config = this.getConfig();
    const client = this.getClient(config);
    const safeFileName = fileName.replace(/[^\w.\-() ]+/g, "_").slice(0, 180) || "upload.zip";
    const key = `uploads/zips/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeFileName}`;
    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadURL = await getSignedUrl(client, command, { expiresIn: 900 });
    return {
      uploadURL,
      objectPath: this.toObjectPath(key),
    };
  }

  async downloadObject(objectPath: string): Promise<Buffer> {
    const key = this.fromObjectPath(objectPath);
    const config = this.getConfig();
    const client = this.getClient(config);
    const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));

    if (!response.Body) {
      throw new B2ObjectNotFoundError();
    }

    if (response.Body instanceof Readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of response.Body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }

    const stream = Readable.from(response.Body as AsyncIterable<Uint8Array>);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async exists(objectPath: string): Promise<boolean> {
    const key = this.fromObjectPath(objectPath);
    const config = this.getConfig();
    const client = this.getClient(config);

    try {
      await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
      return true;
    } catch (error: any) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") {
        return false;
      }
      throw error;
    }
  }

  async deleteObject(objectPath: string): Promise<void> {
    const key = this.fromObjectPath(objectPath);
    const config = this.getConfig();
    const client = this.getClient(config);
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  }

  toObjectPath(key: string): string {
    return `b2://${key}`;
  }

  fromObjectPath(objectPath: string): string {
    if (objectPath.startsWith("b2://")) {
      return objectPath.slice("b2://".length);
    }

    if (objectPath.startsWith("/b2/")) {
      return objectPath.slice("/b2/".length);
    }

    throw new B2ObjectNotFoundError();
  }
}

function normalizeEndpoint(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  if (value.includes(".")) {
    return `https://${value}`;
  }

  return `https://s3.${value}.backblazeb2.com`;
}

function normalizeRegion(value?: string): string {
  if (!value) {
    return "us-west-000";
  }

  try {
    const hostname = value.startsWith("http://") || value.startsWith("https://")
      ? new URL(value).hostname
      : value;
    const match = hostname.match(/(?:^|\.)s3\.([a-z0-9-]+)\.backblazeb2\.com$/i);
    if (match?.[1]) {
      return match[1];
    }
  } catch {}

  return value;
}