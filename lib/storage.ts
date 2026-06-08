import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

// S3-compatible client pointed at MinIO. Used to stream large bundles off the
// object store to local disk for extraction (never fully buffered in memory).

let client: S3Client | null = null;

export function getS3(): S3Client {
  if (client) return client;
  client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
    region: process.env.S3_REGION || "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || "minioadmin",
      secretAccessKey: process.env.S3_SECRET_KEY || "minioadmin",
    },
  });
  return client;
}

export const BUCKET = process.env.S3_BUCKET || "bundles";

export async function ensureBucket(): Promise<void> {
  const s3 = getS3();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  }
}

export async function downloadToFile(key: string, destPath: string): Promise<void> {
  const s3 = getS3();
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`Empty object body for key ${key}`);
  await pipeline(res.Body as Readable, createWriteStream(destPath));
}

// Persist a JSON checkpoint (stage artifact) to object storage.
export async function putJson(key: string, value: unknown): Promise<void> {
  const s3 = getS3();
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json",
    }),
  );
}

// Load a JSON checkpoint back from object storage.
export async function getJson<T>(key: string): Promise<T> {
  const s3 = getS3();
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`Empty object body for key ${key}`);
  const body = res.Body as Readable & {
    transformToString?: () => Promise<string>;
  };
  const text = body.transformToString
    ? await body.transformToString()
    : await streamToString(body);
  return JSON.parse(text) as T;
}

async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

// Delete a single object (best-effort).
export async function deleteObject(key: string): Promise<void> {
  await getS3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// Delete every object under a prefix (e.g. an analysis' checkpoints folder).
export async function deletePrefix(prefix: string): Promise<void> {
  const s3 = getS3();
  let token: string | undefined;
  do {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of list.Contents ?? []) {
      if (obj.Key) {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
      }
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
}
