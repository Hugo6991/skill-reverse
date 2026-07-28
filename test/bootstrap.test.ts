import { describe, expect, it } from "vitest";
import {
  D1_PLACEHOLDER,
  findD1DatabaseId,
  findWorkersDevUrl,
  getConfiguredD1Database,
  updateD1DatabaseId
} from "../scripts/cloudflare-bootstrap-core.mjs";

const productionId = "4f44b7b9-1842-4cd7-9fe7-9cc5420910d8";
const config = `{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "skill-reverse-db",
      "database_id": "${D1_PLACEHOLDER}"
    }
  ]
}
`;

describe("private Cloudflare bootstrap", () => {
  it("finds an existing database without creating a duplicate", () => {
    expect(
      findD1DatabaseId(
        JSON.stringify([{ uuid: productionId, name: "skill-reverse-db" }]),
        "skill-reverse-db"
      )
    ).toBe(productionId);
  });

  it("accepts the Cloudflare API result wrapper", () => {
    expect(
      findD1DatabaseId(
        { result: [{ id: productionId, name: "skill-reverse-db" }] },
        "skill-reverse-db"
      )
    ).toBe(productionId);
  });

  it("returns undefined when the named database is absent", () => {
    expect(findD1DatabaseId("[]", "skill-reverse-db")).toBeUndefined();
  });

  it("updates only the configured DB binding and remains idempotent", () => {
    const updated = updateD1DatabaseId(config, productionId);
    expect(getConfiguredD1Database(updated).database_id).toBe(productionId);
    expect(updateD1DatabaseId(updated, productionId)).toBe(updated);
  });

  it("rejects invalid database identifiers", () => {
    expect(() => updateD1DatabaseId(config, "not-a-uuid")).toThrow(
      "Refusing to write an invalid D1 UUID"
    );
  });

  it("extracts the workers.dev production URL without logging secrets", () => {
    expect(
      findWorkersDevUrl("Deployed skill-reverse triggers (2.1 sec)\nhttps://skill-reverse.hugo.workers.dev")
    ).toBe("https://skill-reverse.hugo.workers.dev");
  });
});
