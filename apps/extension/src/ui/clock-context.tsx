import { createContext, useContext, type ReactNode } from 'react'

// Reloj de la interfaz: función que devuelve el instante actual. Por defecto es el reloj real; las pruebas pasan uno
// fijo para que las fechas que escribe la interfaz (updatedAt, nombre del archivo exportado) sean deterministas.
export type Clock = () => Date

const realClock: Clock = () => new Date()

const ClockContext = createContext<Clock>(realClock)

export function ClockProvider({ now, children }: { readonly now: Clock; readonly children: ReactNode }) {
  return <ClockContext value={now}>{children}</ClockContext>
}

export function useClock(): Clock {
  return useContext(ClockContext)
}
