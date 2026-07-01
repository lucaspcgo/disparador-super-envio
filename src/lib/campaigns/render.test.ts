import { describe, it, expect } from 'vitest'
import { renderMessage } from './render'

describe('renderMessage', () => {
  it('substitui variáveis', () => {
    expect(renderMessage('Oi {{nome}}!', { nome: 'Ana' })).toBe('Oi Ana!')
  })
  it('variável ausente vira vazio', () => {
    expect(renderMessage('Oi {{nome}}!', {})).toBe('Oi !')
  })
  it('spintax escolhe uma opção (rng=0 → primeira)', () => {
    expect(renderMessage('{oi|olá|e aí} {{nome}}', { nome: 'Ana' }, () => 0)).toBe('oi Ana')
  })
  it('spintax rng→última opção', () => {
    expect(renderMessage('{oi|olá|e aí}', {}, () => 0.99)).toBe('e aí')
  })
  it('múltiplos grupos spintax', () => {
    expect(renderMessage('{a|b} {c|d}', {}, () => 0)).toBe('a c')
  })
})
