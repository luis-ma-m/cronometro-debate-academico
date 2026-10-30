import { describe, expect, it } from "vitest";
import { presetSettings } from "../src/tabulation/presets.js";
import { TabulationSettingsValidationError, validateTabulationSettings } from "./tabulation-settings-validation.js";

function validSettings() {
  return presetSettings("ledu-groups");
}

function expectInvalid(value: unknown) {
  expect(() => validateTabulationSettings(value)).toThrow(TabulationSettingsValidationError);
}

describe("validateTabulationSettings", () => {
  it.each(["ledu-groups", "uc3m-swiss", "aduma"] as const)("accepts the %s preset", (presetId) => {
    expect(validateTabulationSettings(presetSettings(presetId))).toEqual(presetSettings(presetId));
  });

  it("accepts a complete supported preset without mutating its input", () => {
    const input = validSettings();
    const before = structuredClone(input);
    const result = validateTabulationSettings(input);

    expect(result).toEqual(before);
    expect(result).not.toBe(input);
    expect(input).toEqual(before);
  });

  it.each([null, undefined, [], "rules", 12])("rejects non-object payloads (%s)", (value) => {
    expectInvalid(value);
  });

  it("rejects missing and unknown schema keys", () => {
    const missing = validSettings() as unknown as Record<string, unknown>;
    delete missing.stage;
    expectInvalid(missing);

    const extra = { ...validSettings(), unexpected: true };
    expectInvalid(extra);
  });

  it("rejects unsupported enum values and non-finite numbers", () => {
    expectInvalid({ ...validSettings(), ballotMode: "automatic" });
    expectInvalid({ ...validSettings(), groupCount: Number.NaN });
    expectInvalid({ ...validSettings(), swissRounds: Number.POSITIVE_INFINITY });
  });

  it("rejects inconsistent score ranges and non-boolean flags", () => {
    expectInvalid({ ...validSettings(), scoreMin: 10, scoreMax: 10 });
    expectInvalid({ ...validSettings(), speakerScoreMin: 8, speakerScoreMax: 7 });
    expectInvalid({ ...validSettings(), avoidSameInstitution: "false" });
  });

  it("rejects duplicate or unknown tiebreak criteria", () => {
    expectInvalid({ ...validSettings(), tiebreaks: ["ballots", "ballots"] });
    expectInvalid({ ...validSettings(), tiebreaks: ["unknown"] });
  });

  it("rejects malformed rubric entries and duplicate rubric IDs", () => {
    const duplicate = validSettings();
    duplicate.rubric = [
      { id: "same", name: "A", section: "S", description: "" },
      { id: "same", name: "B", section: "S", description: "" },
    ];
    expectInvalid(duplicate);

    const malformed = validSettings();
    malformed.rubric = [{ id: "bad id", name: "A", section: "S", description: "" }];
    expectInvalid(malformed);
  });

  it("rejects fractional counts and invalid penalty rules while allowing independent group advance counts", () => {
    expectInvalid({ ...validSettings(), groupCount: 2.5 });
    expect(validateTabulationSettings({ ...validSettings(), groupCount: 2, groupAdvance: 3 })).toMatchObject({ groupCount: 2, groupAdvance: 3 });
    expectInvalid({ ...validSettings(), minorsPerMajor: 0 });
    expectInvalid({ ...validSettings(), speakerScoreStep: 0 });
  });

  it("enforces odd panel sizes when the tournament requires odd panels", () => {
    expectInvalid({ ...validSettings(), oddPanels: true, qualifyingPanelSize: 2 });
    expectInvalid({ ...validSettings(), oddPanels: true, eliminationPanelSize: 4 });
  });

  it("rejects invalid bracket seeds and oversized payloads", () => {
    expectInvalid({ ...validSettings(), bracketSeedOrder: [1, 1] });
    const oversized = validSettings();
    oversized.rubric = Array.from({ length: 100 }, (_, index) => ({
      id: "item-" + index,
      name: "x".repeat(200),
      section: "section",
      description: "d".repeat(1000),
    }));
    expectInvalid(oversized);
  });
});
