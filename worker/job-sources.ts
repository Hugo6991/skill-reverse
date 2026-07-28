import { assertSafePublicUrl } from "./security";

export function normalizeSourceUrl(value: string): string {
  const url = assertSafePublicUrl(value);
  url.hash = "";
  return url.toString();
}

export async function replaceJobSources(
  db: D1Database,
  jobId: string,
  values: string[]
): Promise<string[]> {
  const normalized = [...new Set(values.map(normalizeSourceUrl))].slice(0, 8);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM job_sources WHERE job_id = ?1").bind(jobId),
    db
      .prepare(
        "UPDATE jobs SET support_urls_json = ?1, updated_at = ?2 WHERE id = ?3"
      )
      .bind(JSON.stringify(normalized), now, jobId)
  ];
  normalized.forEach((url, position) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO job_sources
           (id, job_id, url, normalized_url, position, created_at)
           VALUES (?1, ?2, ?3, ?3, ?4, ?5)`
        )
        .bind(crypto.randomUUID(), jobId, url, position, now)
    );
  });
  await db.batch(statements);
  return normalized;
}

export async function loadJobSources(db: D1Database, jobId: string): Promise<string[]> {
  const rows = await db
    .prepare(
      "SELECT url FROM job_sources WHERE job_id = ?1 ORDER BY position ASC LIMIT 8"
    )
    .bind(jobId)
    .all<{ url: string }>();
  return rows.results.map((row) => row.url);
}

export function selectCaptureSources(targetUrl: string, values: string[]): string[] {
  const targetHost = new URL(targetUrl).hostname;
  return values
    .map((url, position) => {
      const host = new URL(url).hostname;
      const priority = host === "github.com" ? 0 : host === targetHost ? 1 : 2;
      return { url, position, priority };
    })
    .sort((left, right) => left.priority - right.priority || left.position - right.position)
    .slice(0, 3)
    .map((item) => item.url);
}
