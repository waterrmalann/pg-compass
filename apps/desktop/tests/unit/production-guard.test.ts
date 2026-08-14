import { describe, expect, it } from "vitest";
import { looksLikeProduction } from "@/shared/production-guard";

describe("looksLikeProduction", () => {
  it("matches prod and production as whole words", () => {
    const productionNames = [
      "prod",
      "PROD",
      "production",
      "my-prod-db",
      "prod_eu",
      "db.prod.example.com",
      "Production replica",
      "prod1",
    ];
    for (const name of productionNames) {
      expect(looksLikeProduction(name)).toBe(true);
    }
  });

  it("ignores words that merely contain prod", () => {
    const otherNames = ["products", "reproduction", "producer", "staging"];
    for (const name of otherNames) {
      expect(looksLikeProduction(name)).toBe(false);
    }
  });

  it("checks every value and skips missing ones", () => {
    expect(looksLikeProduction("Local", undefined, null, "app_prod")).toBe(
      true,
    );
    expect(looksLikeProduction("Local", "localhost", "app")).toBe(false);
    expect(looksLikeProduction()).toBe(false);
  });
});
