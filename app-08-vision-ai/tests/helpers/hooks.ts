// A minimal stand-in for React's hooks so a hook or a component function runs in the node test environment: state, refs and
// memoised callbacks keep their value across renders, an effect re-runs only when its dependency list changed, and effects run
// after the render that queued them. A state setter stores the value; the test calls render() again to see it.
// A test file installs it with: vi.mock('react', async () => (await import('../helpers/hooks')).reactStub)

interface EffectSlot {
  deps?: unknown[]
  cleanup?: void | (() => void)
}

const rt = {
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  memos: [] as { deps?: unknown[]; value: unknown }[],
  effects: [] as EffectSlot[],
  queue: [] as (() => void)[],
  s: 0,
  r: 0,
  m: 0,
  e: 0,
}

const changed = (next?: unknown[], prev?: unknown[]) => !next || !prev || next.some((d, i) => !Object.is(d, prev[i]))

export const reactStub = {
  useState: (init: unknown) => {
    const i = rt.s++
    if (!(i in rt.states)) rt.states[i] = typeof init === 'function' ? (init as () => unknown)() : init
    const set = (value: unknown) => {
      rt.states[i] = typeof value === 'function' ? (value as (prev: unknown) => unknown)(rt.states[i]) : value
    }
    return [rt.states[i], set]
  },
  useRef: (init: unknown) => (rt.refs[rt.r] ??= { current: init }, rt.refs[rt.r++]),
  useCallback: (fn: unknown, deps: unknown[]) => {
    const slot = (rt.memos[rt.m] ??= { deps, value: fn })
    rt.m++
    if (changed(deps, slot.deps)) {
      slot.deps = deps
      slot.value = fn
    }
    return slot.value
  },
  useEffect: (run: () => void | (() => void), deps?: unknown[]) => {
    const slot = (rt.effects[rt.e] ??= {})
    rt.e++
    if (!changed(deps, slot.deps)) return
    slot.deps = deps
    rt.queue.push(() => {
      if (typeof slot.cleanup === 'function') slot.cleanup()
      slot.cleanup = run()
    })
  },
}

/** Runs the hook (or component function) once with fresh slot counters, then its queued effects. */
export function render<T>(fn: () => T): T {
  rt.s = rt.r = rt.m = rt.e = 0
  rt.queue = []
  const out = fn()
  const effects = rt.queue
  rt.queue = []
  for (const run of effects) run()
  return out
}

/** Forgets every slot, as a fresh mount would. Call it before each test. */
export function resetHooks(): void {
  rt.states = []
  rt.refs = []
  rt.memos = []
  rt.effects = []
  rt.queue = []
}

/** Runs the cleanups of every effect, as an unmount would. */
export function unmount(): void {
  for (const slot of rt.effects) if (typeof slot.cleanup === 'function') slot.cleanup()
}
