import type { AircraftKind } from '../shared/index.js';

const HEAVY_TYPES = new Set([
  'A124', 'A225', 'A332', 'A333', 'A337', 'A338', 'A339', 'A342', 'A343', 'A345', 'A346', 'A35K', 'A388',
  'B742', 'B743', 'B744', 'B748', 'B762', 'B763', 'B764', 'B772', 'B773', 'B77L', 'B77W', 'B78X', 'IL76',
  'MD11', 'C5M', 'C17', 'A400',
]);

const HELICOPTER_PREFIXES = ['EC', 'AS', 'AW', 'UH', 'H1', 'H2', 'H4', 'H6', 'R2', 'R4', 'R6', 'B06', 'B407', 'B412', 'MI'];

/** Map an ICAO type code to the coarse aircraft kind used by the UI. */
export function kindForTypeCode(typeCode: string | null | undefined): AircraftKind | null {
  if (!typeCode) return null;
  if (typeCode === 'GLID') return 'glider';
  if (HELICOPTER_PREFIXES.some((p) => typeCode.startsWith(p))) return 'helicopter';
  if (HEAVY_TYPES.has(typeCode)) return 'heavy';
  return null;
}
