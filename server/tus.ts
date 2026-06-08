import http from "node:http";
import { Server, MemoryLocker } from "@tus/server";
import { S3Store } from "@tus/s3-store";
import { db } from "../db";
import { analyses } from "../db/schema";
import { getAnalysisQueue } from "../lib/queue";
import { ensureBucket, BUCKET } from "../lib/storage";

const PORT = Number(process.env.TUS_PORT || 1080);
const PATH = "/files";

function buildStore(): S3Store {
  return new S3Store({
    // 64 MiB parts — good for multi-GB bundles without too many parts.
    partSize: 64 * 1024 * 1024,
    s3ClientConfig: {
      bucket: BUCKET,
      region: process.env.S3_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || "minioadmin",
        secretAccessKey: process.env.S3_SECRET_KEY || "minioadmin",
      },
    },
  });
}

async function main() {
  await ensureBucket();

  const tusServer = new Server({
    path: PATH,
    datastore: buildStore(),
    locker: new MemoryLocker(),
    // Allow the Next.js dev origin to drive uploads cross-origin.
    allowedOrigins: (process.env.CORS_ORIGINS || "http://localhost:3000")
      .split(",")
      .map((s) => s.trim()),
    respectForwardedHeaders: true,
    maxSize: Number(process.env.MAX_UPLOAD_BYTES || 8 * 1024 * 1024 * 1024),
    async onUploadFinish(_req, res, upload) {
      const filename =
        (upload.metadata?.filename as string | undefined) || `${upload.id}.7z`;
      // Persist an analysis record and enqueue the heavy processing job.
      const [row] = await db
        .insert(analyses)
        .values({
          filename,
          size: upload.size ?? 0,
          storageKey: upload.id,
          status: "queued",
          stage: "В очереди",
          progress: 0,
        })
        .returning({ id: analyses.id });

      await getAnalysisQueue().add("analyze", {
        analysisId: row.id,
        storageKey: upload.id,
        filename,
      });

      // Surface the analysis id to the client so the UI can redirect.
      return {
        res,
        status_code: 200,
        headers: { "X-Analysis-Id": row.id },
        body: JSON.stringify({ analysisId: row.id }),
      };
    },
  });

  const httpServer = http.createServer((req, res) => {
    tusServer.handle(req, res);
  });

  httpServer.listen(PORT, () => {
    console.log(`tus upload server listening on http://localhost:${PORT}${PATH}`);
  });
}

main().catch((e) => {
  console.error("tus server failed to start:", e);
  process.exit(1);
});
