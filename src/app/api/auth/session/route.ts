import { clearSessionCookie, readSession } from "@/lib/auth";

export async function GET(request: Request) {
  const session = await readSession(request);
  return Response.json({ session: session ? { address: session.address, kind: session.kind } : null });
}

export async function DELETE() {
  return Response.json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
}
