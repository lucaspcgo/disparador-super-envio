import { describe, it, expect } from 'vitest'
import { genManagedInstanceName } from './naming'

describe('genManagedInstanceName', () => {
  it('gera nome com prefixo se + id da org + sufixo hex de 16', () => {
    const n = genManagedInstanceName('abc12345-0000-0000-0000-000000000000')
    expect(n).toMatch(/^se-abc12345-[0-9a-f]{16}$/)
  })
  it('gera sufixos diferentes em chamadas repetidas (aleatório)', () => {
    const a = genManagedInstanceName('abc12345-0000-0000-0000-000000000000')
    const b = genManagedInstanceName('abc12345-0000-0000-0000-000000000000')
    expect(a).not.toBe(b)
  })
})
