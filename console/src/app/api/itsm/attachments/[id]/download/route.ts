import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/api-client";

const BACKEND_URL = process.env.API_URL || "http://localhost:8000";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const sessionCtx = await getSessionContext();
  if ("response" in sessionCtx) return sessionCtx.response;

  try {
    const token = sessionCtx.session.apiKey;
    const res = await fetch(`${BACKEND_URL}/v1/itsm/attachments/${id}/download`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return NextResponse.json(data, { status: res.status });
    }

    const headers = new Headers();
    const contentType = res.headers.get("content-type");
    const contentDisposition = res.headers.get("content-disposition");
    if (contentType) headers.set("Content-Type", contentType);
    if (contentDisposition) headers.set("Content-Disposition", contentDisposition);

    return new Response(res.body, {
      status: 200,
      headers,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Download failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
