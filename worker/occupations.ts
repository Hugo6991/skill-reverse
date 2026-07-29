import type { OccupationProfile } from "../src/types";
import type { Locale } from "../src/types";

type OccupationRow = {
  code: string;
  title: string;
  description: string;
  provider: "O*NET";
  version: string;
  source_uri: string;
  aliases_json: string;
  competencies_json: string;
  localizations_json: string;
};

type OccupationLocalization = {
  title: string;
  description: string;
  aliases: string[];
  competencyLabels: string[];
};

export function localizedOccupationTitle(
  canonicalTitle: string,
  localizationsJson: string,
  locale: Locale
): string {
  if (locale === "en") return canonicalTitle;
  try {
    const localizations = JSON.parse(localizationsJson) as Partial<
      Record<Locale, OccupationLocalization>
    >;
    return localizations[locale]?.title ?? canonicalTitle;
  } catch {
    return canonicalTitle;
  }
}

export const pilotOccupation: OccupationProfile = {
  code: "15-1255.00",
  title: "Web and Digital Interface Designers",
  description:
    "Design digital interfaces and websites with attention to usability, aesthetics, and functional behavior.",
  provider: "O*NET",
  version: "30.3",
  sourceUri: "https://www.onetonline.org/link/summary/15-1255.00",
  aliases: ["Web Designer", "Product Designer", "UI Designer", "Digital Interface Designer"],
  competencies: [
    {
      kind: "task",
      label: "Design, build, or maintain websites and digital interfaces",
      importance: 95,
      sourceUri: "https://www.onetonline.org/link/summary/15-1255.00"
    },
    {
      kind: "knowledge",
      label: "Design",
      importance: 90,
      sourceUri: "https://www.onetonline.org/link/summary/15-1255.00"
    },
    {
      kind: "knowledge",
      label: "Computers and electronics",
      importance: 84,
      sourceUri: "https://www.onetonline.org/link/summary/15-1255.00"
    },
    {
      kind: "skill",
      label: "Programming",
      importance: 77,
      sourceUri: "https://www.onetonline.org/link/summary/15-1255.00"
    },
    {
      kind: "skill",
      label: "Critical thinking",
      importance: 75,
      sourceUri: "https://www.onetonline.org/link/summary/15-1255.00"
    }
  ]
};

function toProfile(row: OccupationRow, locale: Locale = "en"): OccupationProfile {
  const profile: OccupationProfile = {
    code: row.code,
    title: row.title,
    description: row.description,
    provider: row.provider,
    version: row.version,
    sourceUri: row.source_uri,
    aliases: JSON.parse(row.aliases_json),
    competencies: JSON.parse(row.competencies_json)
  };
  if (locale === "en") return profile;
  try {
    const localizations = JSON.parse(row.localizations_json) as Partial<
      Record<Locale, OccupationLocalization>
    >;
    const localized = localizations[locale];
    if (!localized) return profile;
    return {
      ...profile,
      title: localized.title,
      description: localized.description,
      aliases: localized.aliases,
      competencies: profile.competencies.map((competency, index) => ({
        ...competency,
        label: localized.competencyLabels[index] ?? competency.label
      }))
    };
  } catch {
    return profile;
  }
}

export async function getOccupation(
  db: D1Database,
  code: string,
  locale: Locale = "en"
): Promise<OccupationProfile | null> {
  const row = await db
    .prepare(
      `SELECT code, title, description, provider, version, source_uri,
              aliases_json, competencies_json, localizations_json
       FROM occupations WHERE code = ?1`
    )
    .bind(code)
    .first<OccupationRow>();
  return row ? toProfile(row, locale) : null;
}

export async function searchOccupations(
  db: D1Database,
  query: string,
  locale: Locale = "en"
): Promise<OccupationProfile[]> {
  const normalized = query.trim();
  if (!normalized) {
    const rows = await db
      .prepare(
        `SELECT code, title, description, provider, version, source_uri,
                aliases_json, competencies_json, localizations_json
         FROM occupations ORDER BY
           CASE WHEN code = '15-1255.00' THEN 0 ELSE 1 END, title LIMIT 6`
      )
      .all<OccupationRow>();
    return rows.results.map((row) => toProfile(row, locale));
  }

  const tokens = normalized
    .replaceAll("%", "")
    .replaceAll("_", "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  const where = tokens
    .map(
      (_, index) =>
        `(code LIKE ?${index + 1} OR title LIKE ?${index + 1} OR description LIKE ?${
          index + 1
        } OR aliases_json LIKE ?${index + 1} OR localizations_json LIKE ?${index + 1})`
    )
    .join(" AND ");
  const exactCodeIndex = tokens.length + 1;
  const rows = await db
    .prepare(
      `SELECT code, title, description, provider, version, source_uri,
              aliases_json, competencies_json, localizations_json
       FROM occupations
       WHERE ${where}
       ORDER BY CASE WHEN code = ?${exactCodeIndex} THEN 0 ELSE 1 END, title
       LIMIT 6`
    )
    .bind(...tokens.map((token) => `%${token}%`), normalized)
    .all<OccupationRow>();
  return rows.results.map((row) => toProfile(row, locale));
}
