import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Reports whether server-side integrations are configured (no secrets exposed).
export async function GET() {
  return NextResponse.json({
    gemini: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
    geminiModel: process.env.LLM_MODEL || "gemini-2.5-pro",
    lexiro: Boolean(process.env.LEXIRO_API_URL),
    s3Endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
    tusUrl: process.env.NEXT_PUBLIC_TUS_URL || "http://localhost:1080/files",
  });
}
