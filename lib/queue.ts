import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

import type { StageKey } from "./analyzer/stages";

export interface AnalysisJobData {
  analysisId: string;
  storageKey: string;
  filename: string;
  // When set, resume the pipeline from this stage using stored checkpoints.
  fromStage?: StageKey;
}

export const ANALYSIS_QUEUE = "analysis";

const globalForQueue = globalThis as unknown as {
  __redis?: IORedis;
  __queue?: Queue<AnalysisJobData>;
};

export function getRedis(): IORedis {
  if (globalForQueue.__redis) return globalForQueue.__redis;
  const conn = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
  globalForQueue.__redis = conn;
  return conn;
}

// bullmq bundles its own ioredis copy; cast our shared instance to the type
// bullmq expects (structurally identical, different module identity).
export function getQueueConnection(): ConnectionOptions {
  return getRedis() as unknown as ConnectionOptions;
}

export function getAnalysisQueue(): Queue<AnalysisJobData> {
  if (globalForQueue.__queue) return globalForQueue.__queue;
  const q = new Queue<AnalysisJobData>(ANALYSIS_QUEUE, {
    connection: getQueueConnection(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
  globalForQueue.__queue = q;
  return q;
}
