// Cómo se mueve un elemento: un puesto arriba (-1) o abajo (1), o al puesto de otro elemento (soltar sobre él).
export type Move = { readonly step: -1 | 1 } | { readonly to: string }

// moveIds devuelve la lista de ids con el elemento movido, o undefined si no hay movimiento: extremo de la lista,
// elemento desconocido, soltar sobre sí mismo o cruzar a otra banda. Una banda es un tramo que el orden de pantalla
// mantiene aparte aunque `order` diga otra cosa (favoritas primero, identidad propia primero): moverse a otra banda
// no tendría efecto visible, así que se rechaza.
export function moveIds<T extends { readonly id: string }>(
  list: readonly T[],
  id: string,
  move: Move,
  sameBand: (a: T, b: T) => boolean,
): string[] | undefined {
  const from = list.findIndex((item) => item.id === id)
  if (from === -1) return undefined
  const to = 'step' in move ? from + move.step : list.findIndex((item) => item.id === move.to)
  const moving = list[from]
  const target = list[to]
  if (moving === undefined || target === undefined || to === from || !sameBand(moving, target)) return undefined
  const ids = list.map((item) => item.id)
  ids.splice(from, 1)
  ids.splice(to, 0, id)
  return ids
}
