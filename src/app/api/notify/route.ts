import { emailConfigured, pushConfigured, vapidPublicKey } from "@/lib/notify/deliver";

/** Which channels this server can deliver on; the Signals page unlocks its toggles from this. */
export function GET() {
  return Response.json({ push: pushConfigured ? { publicKey: vapidPublicKey } : null, email: emailConfigured });
}
