import { Queue } from "bullmq";
import IORedis from "ioredis";

export interface AnalysisJobData {
  analysisId: string;
  storageKey: string;
  filename: string;
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

export function getAnalysisQueue(): Queue<AnalysisJobData> {
  if (globalForQueue.__queue) return globalForQueue.__queue;
  const q = new Queue<AnalysisJobData>(ANALYSIS_QUEUE, {
    connection: getRedis(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
  globalForQueue.__queue = q;
  return q;
}
