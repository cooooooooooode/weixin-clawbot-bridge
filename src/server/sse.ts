type Listener = (event: string, data: unknown) => void

const listeners = new Set<Listener>()

export function subscribe(fn: Listener) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function emit(event: string, data: unknown) {
  for (const fn of listeners) {
    fn(event, data)
  }
}
