export const D1_PLACEHOLDER: string;

export function parseD1Databases(raw: string | unknown): Array<Record<string, unknown>>;

export function findD1DatabaseId(
  raw: string | unknown,
  databaseName: string
): string | undefined;

export function getConfiguredD1Database(
  configText: string,
  binding?: string
): {
  binding: string;
  database_name: string;
  database_id: string;
};

export function updateD1DatabaseId(
  configText: string,
  databaseId: string,
  binding?: string
): string;

export function findWorkersDevUrl(output: string): string | undefined;
