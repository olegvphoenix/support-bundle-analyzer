import {
  S3Client,
  GetObjectCommand,
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
