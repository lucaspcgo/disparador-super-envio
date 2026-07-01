import { describe, it, expect } from 'vitest'
import { genManagedInstanceName } from './naming'

describe('genManagedInstanceName', () => {
  it('gera nome estável por org com prefixo se', () => {
    const n = genManagedInstanceName('abc12345-0000-0000-0000-000000000000')
    expect(n).toMatch(/^se-abc12345-[a-z0-9]{6}$/)
  })
})
