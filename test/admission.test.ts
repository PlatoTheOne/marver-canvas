import { beforeEach, describe, expect, it } from 'vitest'
import { admit, release, resetAdmission, SLOTS } from '../src/client/shell/canvas/admission.ts'

// Frame admission: a board's iframes boot on one main thread, so at most SLOTS boot at once, nearest
// the viewport centre first, and a slot goes back the moment its frame is done (or gone).

const tick = () => new Promise<void>((r) => setTimeout(r, 400))   // past the settle delay of a first pump
const started: string[] = []
const ask = (key: string, rank: number) => admit({ key, rank: () => rank, start: () => started.push(key) })

beforeEach(() => { resetAdmission(); started.length = 0 })

describe('admission', () => {
  it('a new batch starts ONE frame, the nearest, whatever the order they asked in; once it is done, up to SLOTS', async () => {
    for (const [k, r] of [['far', 900], ['near', 10], ['mid', 300], ['nearer', 5], ['farther', 1200], ['midder', 400]] as const) ask(k, r)
    await tick()
    expect(started).toEqual(['nearer'])
    release('nearer')
    await tick()
    expect(started).toEqual(['nearer', 'near', 'mid', 'midder', 'far'].slice(0, SLOTS + 1))
  })
  it('a released slot starts the next in rank; releasing a queued frame drops it from the queue', async () => {
    for (const [k, r] of [['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5], ['f', 6]] as const) ask(k, r)
    await tick()
    release('e')           // never started: leaves the queue
    release('a')           // done: its slot goes to the next by rank
    await tick()
    expect(started).toEqual(['a', 'b', 'c', 'd', 'f'])
  })
  it('ranks are read when a slot frees, not when the frame asked (the camera may have moved)', async () => {
    let rank = 100
    admit({ key: 'moving', rank: () => rank, start: () => started.push('moving') })
    for (const [k, r] of [['a', 1], ['b', 2], ['c', 3], ['d', 4], ['fixed', 50]] as const) ask(k, r)
    await tick()
    rank = 0
    release('a')
    await tick()
    expect(started[1]).toBe('moving')
  })
  it('asking again for an active frame is a no-op; unmount before start is clean', async () => {
    ask('a', 1); await tick()
    ask('a', 1); await tick()
    expect(started).toEqual(['a'])
    ask('b', 2); release('b'); await tick()
    expect(started).toEqual(['a'])
  })
})
