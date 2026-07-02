import { NextResponse } from "next/server";
import { loadInquiry, type HeavyStorageOptions } from "@/lib/heavy/storage";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: { id: string } | Promise<{ id: string }>;
};

export function createInquiryByIdGetHandler(options: HeavyStorageOptions = {}) {
  return async function GET(_request: Request, context: RouteContext) {
    const params = await context.params;
    const inquiry = await loadInquiry(params.id, options);

    if (!inquiry) {
      return NextResponse.json({ message: "Inquiry not found" }, { status: 404 });
    }

    return NextResponse.json(inquiry);
  };
}

export const GET = createInquiryByIdGetHandler();
