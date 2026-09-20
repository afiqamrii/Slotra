export const terminology: Record<string, string> = {
  badminton: "Court", pickleball: "Court", tennis: "Court", padel: "Court",
  futsal: "Pitch", basketball: "Court", squash: "Court",
  table_tennis: "Table", swimming: "Lane", golf_simulator: "Simulator",
};
export function spaceTerm(code: string) { return terminology[code.toLowerCase()] ?? "Space"; }
export function generatedNames(sport: { name: string; code: string }, count: number) {
  if (!Number.isInteger(count) || count < 0 || count > 100) throw new Error("Choose 0–100 spaces");
  return Array.from({ length: count }, (_, index) => `${sport.name} ${spaceTerm(sport.code)} ${index + 1}`);
}


