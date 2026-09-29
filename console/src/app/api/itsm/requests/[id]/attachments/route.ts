import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/api-client";

const BACKEND_URL = process.env.API_URL || "http://localhost:8000";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const sessionCtx = await getSessionContext();
  if ("response" in sessionCtx) return sessionCtx.response;

  try {
    const formData = await request.formData();
    const token = sessionCtx.session.apiKey;

    const res = await fetch(`${BACKEND_URL}/v1/itsm/requests/${id}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const sessionCtx = await getSessionContext();
  if ("response" in sessionCtx) return sessionCtx.response;

  try {
    const token = sessionCtx.session.apiKey;
    const res = await fetch(`${BACKEND_URL}/v1/itsm/requests/${id}/attachments`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json().catch(() => ([]));
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
