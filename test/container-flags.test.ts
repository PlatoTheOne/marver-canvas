import { describe, expect, it } from 'vitest'
import { containerFlags } from '../src/server/cdp.ts'

// A build image runs Chrome as root (Railway, a Dockerfile): the sandbox must be off there and
// nowhere else.
describe('containerFlags', () => {
  it('root on linux: no sandbox, no /dev/shm tiles', () => expect(containerFlags('linux', 0)).toEqual(['--no-sandbox', '--disable-dev-shm-usage']))
  it('a linux user, a mac, windows: nothing', () => {
    expect(containerFlags('linux', 1000)).toEqual([])
    expect(containerFlags('darwin', 0)).toEqual([])
    expect(containerFlags('win32', undefined)).toEqual([])
  })
})
