// Módulo interno de core (index.ts no lo exporta): comprobaciones de forma compartidas entre módulos.

// Un objeto JSON que no es null ni un array.
export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}
