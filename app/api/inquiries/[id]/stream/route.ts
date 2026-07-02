import { loadInquiry, readTurnEvents, type HeavyStorageOptions } from "@/lib/heavy/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type RouteContext = {
  params: { id: string } | Promise<{ id: string }>;
};

type StreamOptions = HeavyStorageOptions & {
  pollIntervalMs?: number;
};

export function createInquiryStreamGetHandler(options: StreamOptions = {}) {
  return async function GET(_request: Request, context: RouteContext) {
    const params = await context.params;
    const inquiry = await loadInquiry(params.id, options);

    if (!inquiry) {
      return Response.json({ message: "Inquiry not found" }, { status: 404 });
    }

    const turn = inquiry.turns.at(-1);
    if (!turn) {
      return Response.json({ message: "Inquiry has no turn" }, { status: 404 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let sent = 0;
        const sendNewEvents = async () => {
          const events = await readTurnEvents(turn.id, options);
          for (const event of events.slice(sent)) {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          }
          sent = events.length;
          return events;
        };

        await sendNewEvents();
        const latest = await loadInquiry(params.id, options);
        if (latest?.status === "completed" || latest?.status === "failed") {
          controller.close();
          return;
        }

        const interval = setInterval(async () => {
          try {
            await sendNewEvents();
            const current = await loadInquiry(params.id, options);
            if (current?.status === "completed" || current?.status === "failed") {
              clearInterval(interval);
              controller.close();
            }
          } catch (error) {
            clearInterval(interval);
            controller.error(error);
          }
        }, options.pollIntervalMs ?? 1000);
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  };
}

export const GET = createInquiryStreamGetHandler();
