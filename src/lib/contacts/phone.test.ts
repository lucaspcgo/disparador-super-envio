import { describe, it, expect } from 'vitest'
import { normalizePhoneBR } from './phone'

describe('normalizePhoneBR', () => {
  it('celular com DDD (11 dígitos) → +55', () => {
    expect(normalizePhoneBR('11999998888')).toBe('+5511999998888')
  })
  it('formatado com máscara', () => {
    expect(normalizePhoneBR('(11) 99999-8888')).toBe('+5511999998888')
  })
  it('já com 55', () => {
    expect(normalizePhoneBR('5511999998888')).toBe('+5511999998888')
  })
  it('já com +55', () => {
    expect(normalizePhoneBR('+55 11 99999-8888')).toBe('+5511999998888')
  })
  it('remove zero de operadora à esquerda', () => {
    expect(normalizePhoneBR('011999998888')).toBe('+5511999998888')
  })
  it('fixo com DDD (10 dígitos)', () => {
    expect(normalizePhoneBR('1133334444')).toBe('+551133334444')
  })
  it('internacional preservado', () => {
    expect(normalizePhoneBR('+14155552671')).toBe('+14155552671')
  })
  it('inválido → null', () => {
    expect(normalizePhoneBR('123')).toBeNull()
    expect(normalizePhoneBR('')).toBeNull()
    expect(normalizePhoneBR('abc')).toBeNull()
  })
})
