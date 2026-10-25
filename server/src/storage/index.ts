import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { config } from "../config";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

export interface StorageDriver {
  upload(params: {
    buffer: Buffer;
    originalFileName: string;
    mimeType: string;
    subDir?: "reports" | "prescriptions" | "temp";
  }): Promise<{ filePath: string; storedFileName: string; fileSize: number }>;

  getBuffer(filePathOrKey: string): Promise<Buffer>;

  getStream(filePathOrKey: string): Promise<Readable>;

  delete(filePathOrKey: string): Promise<void>;

  deleteAll(subDir?: string): Promise<void>;

  exists(filePathOrKey: string): Promise<boolean>;
}

// -------------------------------------------------------------
// 1. Disk Storage Driver (Local Development & Testing)
// -------------------------------------------------------------
export class DiskStorageDriver implements StorageDriver {
  private uploadsRoot: string;

  constructor() {
    this.uploadsRoot = path.resolve(config.dataDir, "uploads");
    for (const dir of [
      this.uploadsRoot,
      path.resolve(this.uploadsRoot, "reports"),
      path.resolve(this.uploadsRoot, "prescriptions"),
      path.resolve(this.uploadsRoot, "temp"),
    ]) {
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch {
          // Ignore if cannot create
        }
      }
    }
  }

  async upload(params: {
    buffer: Buffer;
    originalFileName: string;
    mimeType: string;
    subDir?: "reports" | "prescriptions" | "temp";
  }): Promise<{ filePath: string; storedFileName: string; fileSize: number }> {
    const ext = path.extname(params.originalFileName).toLowerCase() || ".pdf";
    const storedFileName = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}${ext}`;
    const targetDir = params.subDir
      ? path.resolve(this.uploadsRoot, params.subDir)
      : this.uploadsRoot;

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filePath = path.resolve(targetDir, storedFileName);
    fs.writeFileSync(filePath, params.buffer);

    return {
      filePath,
      storedFileName,
      fileSize: params.buffer.length,
    };
  }

  async getBuffer(filePathOrKey: string): Promise<Buffer> {
    const resolvedPath = path.isAbsolute(filePathOrKey)
      ? filePathOrKey
      : path.resolve(this.uploadsRoot, filePathOrKey);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${filePathOrKey}`);
    }
    return fs.readFileSync(resolvedPath);
  }

  async getStream(filePathOrKey: string): Promise<Readable> {
    const resolvedPath = path.isAbsolute(filePathOrKey)
      ? filePathOrKey
      : path.resolve(this.uploadsRoot, filePathOrKey);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${filePathOrKey}`);
    }
    return fs.createReadStream(resolvedPath);
  }

  async delete(filePathOrKey: string): Promise<void> {
    const resolvedPath = path.isAbsolute(filePathOrKey)
      ? filePathOrKey
      : path.resolve(this.uploadsRoot, filePathOrKey);

    if (fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
    }
  }

  async deleteAll(subDir?: string): Promise<void> {
    const targetDir = subDir
      ? path.resolve(this.uploadsRoot, subDir)
      : this.uploadsRoot;

    if (!fs.existsSync(targetDir)) return;

    const clearRecursive = (dir: string) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          clearRecursive(full);
        } else {
          try {
            fs.unlinkSync(full);
          } catch {
            // Ignore unlink errors
          }
        }
      }
    };

    clearRecursive(targetDir);
  }

  async exists(filePathOrKey: string): Promise<boolean> {
    const resolvedPath = path.isAbsolute(filePathOrKey)
      ? filePathOrKey
      : path.resolve(this.uploadsRoot, filePathOrKey);

    return fs.existsSync(resolvedPath);
  }
}

// -------------------------------------------------------------
// 2. S3 Storage Driver (Neon Object Storage / S3-compatible)
// -------------------------------------------------------------
export class S3StorageDriver implements StorageDriver {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = config.s3BucketName || "records";
    this.client = new S3Client({
      forcePathStyle: true, // Required for Neon Object Storage
      region: config.awsRegion || "us-east-2",
      endpoint: config.awsEndpointUrlS3 || undefined,
      credentials: {
        accessKeyId: config.awsAccessKeyId,
        secretAccessKey: config.awsSecretAccessKey,
      },
    });
  }

  // Normalize key from potential disk path or key
  private normalizeKey(keyOrPath: string): string {
    let key = keyOrPath.replace(/\\/g, "/");
    // If it contains "uploads/", take everything after it
    const uploadsIdx = key.indexOf("uploads/");
    if (uploadsIdx !== -1) {
      key = key.substring(uploadsIdx + "uploads/".length);
    }
    return key.replace(/^\/+/, "");
  }

  async upload(params: {
    buffer: Buffer;
    originalFileName: string;
    mimeType: string;
    subDir?: "reports" | "prescriptions" | "temp";
  }): Promise<{ filePath: string; storedFileName: string; fileSize: number }> {
    const ext = path.extname(params.originalFileName).toLowerCase() || ".pdf";
    const storedFileName = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}${ext}`;
    const key = params.subDir ? `${params.subDir}/${storedFileName}` : storedFileName;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: params.buffer,
        ContentType: params.mimeType || "application/pdf",
      })
    );

    return {
      filePath: key,
      storedFileName,
      fileSize: params.buffer.length,
    };
  }

  async getBuffer(filePathOrKey: string): Promise<Buffer> {
    const key = this.normalizeKey(filePathOrKey);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );

    if (!response.Body) {
      throw new Error(`Empty body returned from S3 for key ${key}`);
    }

    if (typeof (response.Body as any).transformToByteArray === "function") {
      const byteArray = await (response.Body as any).transformToByteArray();
      return Buffer.from(byteArray);
    }

    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async getStream(filePathOrKey: string): Promise<Readable> {
    const key = this.normalizeKey(filePathOrKey);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );

    if (!response.Body) {
      throw new Error(`Empty stream returned from S3 for key ${key}`);
    }

    return response.Body as Readable;
  }

  async delete(filePathOrKey: string): Promise<void> {
    const key = this.normalizeKey(filePathOrKey);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
  }

  async deleteAll(subDir?: string): Promise<void> {
    const prefix = subDir ? `${subDir.replace(/\/+$/, "")}/` : "";
    let continuationToken: string | undefined = undefined;

    do {
      const listRes: ListObjectsV2CommandOutput = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix || undefined,
          ContinuationToken: continuationToken,
        })
      );

      if (listRes.Contents && listRes.Contents.length > 0) {
        for (const item of listRes.Contents) {
          if (item.Key) {
            await this.client.send(
              new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: item.Key,
              })
            );
          }
        }
      }

      continuationToken = listRes.NextContinuationToken;
    } while (continuationToken);
  }

  async exists(filePathOrKey: string): Promise<boolean> {
    try {
      const key = this.normalizeKey(filePathOrKey);
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }
}

// -------------------------------------------------------------
// Factory & Export
// -------------------------------------------------------------
export function createStorageDriver(): StorageDriver {
  if (config.storageDriver === "s3") {
    return new S3StorageDriver();
  }
  return new DiskStorageDriver();
}

export const storage = createStorageDriver();
export default storage;
