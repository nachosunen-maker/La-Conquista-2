export interface AggregatePopulationFallback {
  total: number;
  available: number;
  kingdomId: string;
}

export function createAggregatePopulationFallback(
  kingdomId: string,
  population: unknown,
  available: unknown
): AggregatePopulationFallback | null {
  if (
    typeof population !== "number" || !Number.isInteger(population) || population < 0 ||
    typeof available !== "number" || !Number.isInteger(available) || available < 0 ||
    available > population
  ) {
    return null;
  }

  return { total: population, available, kingdomId };
}