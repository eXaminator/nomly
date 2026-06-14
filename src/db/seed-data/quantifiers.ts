/**
 * Curated quantifier seed — the canonical list of word-form quantifiers the
 * app ships with (German cardinal numbers, fractions, and vague plurals).
 *
 * Each entry's `name` is the canonical German form; `aliases` carries English
 * variants, inflected forms, and common spelling variants the matcher relies
 * on. `value` is the numeric equivalent (null for vague/unspecified quantities
 * like "einige" or "ein paar").
 */
export type SeedQuantifier = {
  name: string;
  aliases: string[];
  value: number | null;
};

export const SEED_QUANTIFIERS: SeedQuantifier[] = [
  { name: "ein", aliases: ["eine", "einen", "einem", "einer", "eins", "a", "an", "one"], value: 1 },
  { name: "zwei", aliases: ["two"], value: 2 },
  { name: "drei", aliases: ["three"], value: 3 },
  { name: "vier", aliases: ["four"], value: 4 },
  { name: "fünf", aliases: ["five"], value: 5 },
  { name: "sechs", aliases: ["six"], value: 6 },
  { name: "sieben", aliases: ["seven"], value: 7 },
  { name: "acht", aliases: ["eight"], value: 8 },
  { name: "neun", aliases: ["nine"], value: 9 },
  { name: "zehn", aliases: ["ten"], value: 10 },
  { name: "elf", aliases: ["eleven"], value: 11 },
  { name: "zwölf", aliases: ["twelve", "dutzend", "a dozen"], value: 12 },
  { name: "ein halber", aliases: ["eine halbe", "ein halbes", "einer halben", "einen halben", "einem halben", "halber", "halbe", "halbes", "halben", "half"], value: 0.5 },
  { name: "viertel", aliases: ["ein viertel", "quarter"], value: 0.25 },
  { name: "dreiviertel", aliases: ["three quarters"], value: 0.75 },
  { name: "einige", aliases: ["several"], value: null },
  { name: "ein paar", aliases: ["a few", "a couple", "a couple of"], value: null },
  { name: "mehrere", aliases: [], value: null },
  { name: "some", aliases: [], value: null },
];
