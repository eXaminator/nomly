import { describe, expect, it } from "vitest";

import { buildQuantifierPayload } from "@/components/settings/stammdaten/edit-forms/quantifier-form";

describe("buildQuantifierPayload", () => {
  it("trims the name and reports valid", () => {
    const { payload, valid } = buildQuantifierPayload({
      name: "  eine Prise ",
      valueText: "1",
      aliases: [],
      sortOrderText: "0",
    });
    expect(valid).toBe(true);
    expect(payload.name).toBe("eine Prise");
    expect(payload.value).toBe(1);
    expect(payload.sortOrder).toBe(0);
  });

  it("treats an empty value as unspecified (null) and stays valid", () => {
    const { payload, valid } = buildQuantifierPayload({
      name: "einige",
      valueText: "",
      aliases: ["ein paar"],
      sortOrderText: "5",
    });
    expect(valid).toBe(true);
    expect(payload.value).toBeNull();
    expect(payload.aliases).toEqual(["ein paar"]);
    expect(payload.sortOrder).toBe(5);
  });

  it("parses a comma decimal value", () => {
    const { payload, valid } = buildQuantifierPayload({
      name: "halb",
      valueText: "0,5",
      aliases: [],
      sortOrderText: "",
    });
    expect(valid).toBe(true);
    expect(payload.value).toBe(0.5);
    expect(payload.sortOrder).toBe(0);
  });

  it("is invalid when the name is blank", () => {
    const { valid } = buildQuantifierPayload({
      name: "   ",
      valueText: "1",
      aliases: [],
      sortOrderText: "0",
    });
    expect(valid).toBe(false);
  });

  it("is invalid when the value is non-numeric", () => {
    const { valid } = buildQuantifierPayload({
      name: "etwas",
      valueText: "abc",
      aliases: [],
      sortOrderText: "0",
    });
    expect(valid).toBe(false);
  });
});
