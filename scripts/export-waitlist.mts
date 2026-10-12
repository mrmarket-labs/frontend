/**
 * Export every waitlist submission from the private Blob store as CSV on stdout.
 *
 *   BLOB_READ_WRITE_TOKEN=... node scripts/export-waitlist.mts > waitlist.csv
 *
 * The token is the one on the `diversify` Vercel project (Storage → waitlist). Newest last.
 */
import { get, list } from "@vercel/blob";

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("Set BLOB_READ_WRITE_TOKEN (Vercel → diversify → Storage → waitlist).");
  process.exit(1);
}

const COLUMNS = ["at", "email", "name", "telegram", "wouldAct", "trust", "liked", "missing", "notes", "wallet", "locale", "persona", "risk", "cadence", "size", "id"] as const;
const csv = (v: unknown) => {
  const s = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const rows: Record<string, unknown>[] = [];
let cursor: string | undefined;
do {
  const page = await list({ prefix: "waitlist/", cursor });
  for (const b of page.blobs) {
    const res = await get(b.pathname, { access: "private", useCache: false });
    if (!res) continue;
    const entry = JSON.parse(await new Response(res.stream).text());
    rows.push({ ...entry, persona: entry.context?.personaId, risk: entry.context?.risk, cadence: entry.context?.cadence, size: entry.context?.sizeBucket });
  }
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);

rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
console.log(COLUMNS.join(","));
for (const r of rows) console.log(COLUMNS.map((c) => csv(r[c])).join(","));
console.error(`${rows.length} submission${rows.length === 1 ? "" : "s"}`);
