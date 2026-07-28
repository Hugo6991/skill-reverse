export const D1_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseD1Databases(raw) {
  const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
  const databases = Array.isArray(payload) ? payload : payload?.result;
  if (!Array.isArray(databases)) {
    throw new Error("Wrangler returned an unexpected D1 list shape");
  }
  return databases;
}

export function findD1DatabaseId(raw, databaseName) {
  const matches = parseD1Databases(raw).filter((database) => database?.name === databaseName);
  if (matches.length > 1) {
    throw new Error(`More than one D1 database is named ${databaseName}`);
  }
  if (matches.length === 0) return undefined;
  const id = matches[0].uuid ?? matches[0].id;
  if (typeof id !== "string" || !uuidPattern.test(id)) {
    throw new Error(`D1 database ${databaseName} has an invalid UUID`);
  }
  return id;
}

export function getConfiguredD1Database(configText, binding = "DB") {
  const config = JSON.parse(configText);
  const databases = Array.isArray(config.d1_databases) ? config.d1_databases : [];
  const matches = databases.filter((database) => database?.binding === binding);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one D1 binding named ${binding}`);
  }
  return matches[0];
}

export function updateD1DatabaseId(configText, databaseId, binding = "DB") {
  if (!uuidPattern.test(databaseId)) throw new Error("Refusing to write an invalid D1 UUID");

  const configured = getConfiguredD1Database(configText, binding);
  if (configured.database_id === databaseId) return configText;

  const bindingToken = `"binding": "${binding}"`;
  const bindingStart = configText.indexOf(bindingToken);
  if (bindingStart === -1) throw new Error(`D1 binding ${binding} was not found in wrangler.jsonc`);

  const nextBinding = configText.indexOf('"binding":', bindingStart + bindingToken.length);
  const bindingEnd = nextBinding === -1 ? configText.length : nextBinding;
  const segment = configText.slice(bindingStart, bindingEnd);
  const idPattern = /("database_id"\s*:\s*")([^"]+)(")/;
  if (!idPattern.test(segment)) {
    throw new Error(`D1 binding ${binding} does not contain database_id`);
  }

  const nextSegment = segment.replace(idPattern, `$1${databaseId}$3`);
  const nextConfig = configText.slice(0, bindingStart) + nextSegment + configText.slice(bindingEnd);
  getConfiguredD1Database(nextConfig, binding);
  return nextConfig;
}

export function findWorkersDevUrl(output) {
  return output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev(?:\/[^\s]*)?/i)?.[0];
}
