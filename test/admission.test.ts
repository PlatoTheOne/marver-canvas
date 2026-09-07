import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { admit, HEAD_MS, release, resetAdmission, SLOTS } from '../src/client/shell/canvas/admission.ts'

// Frame admission: a board's iframes boot on one main thread, so at most SLOTS boot at once, one
// first, nearest the centre of the view first, and a slot goes back the moment its frame is done.

const started: string[] = []
const ask = (key: string, rank: number) => admit({ key, rank: () => rank, start: () => started.push(key) })
const settle = () => vi.advanceTimersByTimeAsync(400)   // past the first pump's settle delay

beforeEach(() => { vi.useFakeTimers(); resetAdmission(); started.length = 0 })
afterEach(() => vi.useRealTimers())

describe('admission', () => {
  it('a new batch starts ONE frame, the nearest, whatever the order they asked in; once it is done, up to SLOTS', async () => {
    for (const [k, r] of [['far', 900], ['near', 10], ['mid', 300], ['nearer', 5], ['farther', 1200], ['midder', 400]] as const) ask(k, r)
    await settle()
    expect(started).toEqual(['nearer'])
    release('nearer')
    await settle()
    expect(started).toEqual(['nearer', 'near', 'mid', 'midder', 'far'].slice(0, SLOTS + 1))
  })
  it('a released slot starts the next in rank; releasing a queued frame drops it from the queue', async () => {
    for (const [k, r] of [['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5], ['f', 6]] as const) ask(k, r)
    await settle()
    release('e')           // never started: leaves the queue
    release('a')           // done: its slot goes to the next by rank
    await settle()
    expect(started).toEqual(['a', 'b', 'c', 'd', 'f'])
  })
  it('ranks are read when a slot frees, not when the frame asked (the camera may have moved)', async () => {
    let rank = 100
    admit({ key: 'moving', rank: () => rank, start: () => started.push('moving') })
    for (const [k, r] of [['a', 1], ['b', 2], ['c', 3], ['d', 4], ['fixed', 50]] as const) ask(k, r)
    await settle()
    rank = 0
    release('a')
    await settle()
    expect(started[1]).toBe('moving')
  })
  it('the head start is bounded: a first frame that never finishes does not hold the batch', async () => {
    for (const [k, r] of [['stalled', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]] as const) ask(k, r)
    await settle()
    expect(started).toEqual(['stalled'])
    await vi.advanceTimersByTimeAsync(HEAD_MS)
    expect(started).toEqual(['stalled', 'b', 'c', 'd'])   // the stalled one keeps its slot
  })
  it('a batch cancelled before its first pump does not admit the next batch early; asking twice is a no-op', async () => {
    ask('a', 1)
    await vi.advanceTimersByTimeAsync(300)
    release('a')                 // the board went away
    ask('b', 1)                  // a new board
    await vi.advanceTimersByTimeAsync(100)   // the old batch's pump would have fired here
    expect(started).toEqual([])
    await settle()
    expect(started).toEqual(['b'])
    ask('b', 1); await settle()
    expect(started).toEqual(['b'])
  })
})
