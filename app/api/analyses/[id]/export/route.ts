import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { analyses } from "@/db/schema";
import { reportToMarkdown } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format") || "md";
  const [row] = await db.select().from(analyses).where(eq(analyses.id, id)).limit(1);
  if (!row || !row.report) {
    return NextResponse.json({ error: "report not ready" }, { status: 404 });
  }

  if (format === "json") {
    return new NextResponse(JSON.stringify(row.report, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="analysis-${id}.json"`,
      },
    });
  }

  const md = reportToMarkdown(row.report, row.filename);
  return new NextResponse(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="analysis-${id}.md"`,
    },
  });
}
