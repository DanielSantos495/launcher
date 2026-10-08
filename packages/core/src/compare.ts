// Un solo Collator con el idioma fijado: el orden no cambia con el idioma del navegador y no se crea uno por llamada.
// 'base' ignora mayúsculas y tildes ("Árbol" empata con "arbol"); numeric ordena "cuenta 2" antes de "cuenta 10".
const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

// compareText ordena textos visibles (etiquetas, nombres). Puede empatar: hay que desempatar con compareId.
export function compareText(a: string, b: string): number {
  return collator.compare(a, b)
}

// compareId desempata por id con un orden total: unidades de código, sin ignorar mayúsculas (los ids las distinguen).
export function compareId(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}
