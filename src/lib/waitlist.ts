import { put } from "@vercel/blob";
import type { FeedbackContext, FeedbackForm } from "./waitlist-options";

/** Submissions live in the private `waitlist` Blob store, one JSON file each; `scripts/export-waitlist.mts` turns them into a CSV. */
export const waitlistConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export interface WaitlistEntry extends FeedbackForm {
  id: string;
  /** ISO time of the submission. */
  at: string;
  locale: string;
  /** The wallet that was signed in when they submitted, if any. */
  wallet?: string;
  context?: FeedbackContext;
}

export async function saveWaitlistEntry(entry: WaitlistEntry): Promise<void> {
  await put(`waitlist/${entry.at.replace(/[:.]/g, "-")}-${entry.id}.json`, JSON.stringify(entry, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
  });
}
