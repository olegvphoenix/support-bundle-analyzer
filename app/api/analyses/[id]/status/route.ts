import { eq } from "drizzle-orm";
import { db } from "@/db";
import { analyses } from "@/db/schema";

export const dynamic = "force-dynamic";

// Server-Sent Events stream of processing progress. The UI subscribes to this
// to render the live progress bar until the analysis is done or errors out.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      while (!closed) {
        const [row] = await db
          .select({
            status: analyses.status,
            progress: analyses.progress,
            stage: analyses.stage,
            error: analyses.error,
          })
          .from(analyses)
          .where(eq(analyses.id, id))
          .limit(1);

        if (!row) {
          send({ status: "error", error: "not found" });
          break;
        }
        send(row);
        if (row.status === "done" || row.status === "error") break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
