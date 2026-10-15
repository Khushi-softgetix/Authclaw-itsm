import { NextResponse } from "next/server";

const BACKEND_URL = process.env.API_URL || "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const response = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    console.error("ITSM account activation proxy error:", error);
    return NextResponse.json({ detail: "Activation request failed. Please check your network connection and try again." }, { status: 500 });
  }
}
