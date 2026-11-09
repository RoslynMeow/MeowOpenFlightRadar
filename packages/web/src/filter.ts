import type { Aircraft } from '@flightradar/shared';

/** Aircraft filter applied client-side before drawing / picking. */
export interface AircraftFilter {
  /** Callsign prefix, e.g. CCA. */
  airline: string;
  /** ICAO type code fragment, e.g. B738. */
  type: string;
  minAlt: number | null;
  maxAlt: number | null;
}

export const EMPTY_FILTER: AircraftFilter = { airline: '', type: '', minAlt: null, maxAlt: null };

export function matchesFilter(ac: Aircraft, filter: AircraftFilter): boolean {
  if (filter.airline) {
    const callsign = (ac.callsign ?? '').toUpperCase();
    if (!callsign.startsWith(filter.airline.toUpperCase())) return false;
  }
  if (filter.type) {
    const type = (ac.typeCode ?? '').toUpperCase();
    if (!type.includes(filter.type.toUpperCase())) return false;
  }
  if (filter.minAlt !== null && (ac.altFt === null || ac.altFt < filter.minAlt)) return false;
  if (filter.maxAlt !== null && (ac.altFt === null || ac.altFt > filter.maxAlt)) return false;
  return true;
}

/** Parse a persisted filter, falling back to an empty filter on bad input. */
export function parseFilter(raw: string | null): AircraftFilter {
  if (!raw) return { ...EMPTY_FILTER };
  try {
    const value = JSON.parse(raw) as Partial<AircraftFilter>;
    return {
      airline: typeof value.airline === 'string' ? value.airline : '',
      type: typeof value.type === 'string' ? value.type : '',
      minAlt: typeof value.minAlt === 'number' && Number.isFinite(value.minAlt) ? value.minAlt : null,
      maxAlt: typeof value.maxAlt === 'number' && Number.isFinite(value.maxAlt) ? value.maxAlt : null,
    };
  } catch {
    return { ...EMPTY_FILTER };
  }
}
