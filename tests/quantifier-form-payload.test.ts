import { describe, expect, it } from "vitest";

import { buildQuantifierPayload } from "@/components/settings/stammdaten/edit-forms/quantifier-form";

describe("buildQuantifierPayload", () => {
  it("trims the name and reports valid", () => {
    const { payload, valid } = buildQuantifierPayload({
      name: "  eine Prise ",
      valueText: "1",
      aliases: [],
    });
    expect(valid).toBe(true);
    expect(payload.name).toBe("eine Prise");
    expect(payload.value).toBe(1);
  });

  it("treats an empty value as unspecified (null) and stays valid", () => {
    const { payload, valid } = buildQuantifierPayload({
      name: "einige",
      valueText: "",
      aliases: ["ein paar"],
    });
    expect(valid).toBe(true);
    expect(payload.value).toBeNull();
    expect(payload.aliases).toEqual(["ein paar"]);
  });

  it("parses a comma decimal value", () => {
    const { payload, valid } = buildQuantifierPayload({
      name: "halb",
      valueText: "0,5",
      aliases: [],
    });
    expect(valid).toBe(true);
    expect(payload.value).toBe(0.5);
  });

  it("is invalid when the name is blank", () => {
    const { valid } = buildQuantifierPayload({
      name: "   ",
      valueText: "1",
      aliases: [],
    });
    expect(valid).toBe(false);
  });

  it("is invalid when the value is non-numeric", () => {
    const { valid } = buildQuantifierPayload({
      name: "etwas",
      valueText: "abc",
      aliases: [],
    });
    expect(valid).toBe(false);
  });
});
