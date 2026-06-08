import { NextResponse } from "next/server";
import { loadSettings, saveSettings, redactSettings, type AppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await loadSettings(true);
  return NextResponse.json(redactSettings(settings));
}

export async function PUT(req: Request) {
  const body = (await req.json()) as Partial<AppSettings>;
  const patch: Partial<AppSettings> = {};

  if (typeof body.llmProvider === "string") patch.llmProvider = body.llmProvider.trim();
  if (typeof body.llmModel === "string") patch.llmModel = body.llmModel.trim();
  if (typeof body.llmApiKey === "string") patch.llmApiKey = body.llmApiKey;
  if (body.tokenBudget != null) patch.tokenBudget = Number(body.tokenBudget);
  if (typeof body.ragEnabled === "boolean") patch.ragEnabled = body.ragEnabled;
  if (typeof body.ragUrl === "string") patch.ragUrl = body.ragUrl.trim();
  if (typeof body.ragApiKey === "string") patch.ragApiKey = body.ragApiKey;
  if (typeof body.maskPii === "boolean") patch.maskPii = body.maskPii;
  if (typeof body.s3Endpoint === "string") patch.s3Endpoint = body.s3Endpoint.trim();
  if (typeof body.s3Bucket === "string") patch.s3Bucket = body.s3Bucket.trim();
  if (body.maxUploadGb != null) patch.maxUploadGb = Number(body.maxUploadGb);
  if (body.retentionDays != null) patch.retentionDays = Number(body.retentionDays);

  const next = await saveSettings(patch);
  return NextResponse.json(redactSettings(next));
}
