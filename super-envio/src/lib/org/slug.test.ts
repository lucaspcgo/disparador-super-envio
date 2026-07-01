import { describe, it, expect } from 'vitest'
import { slugify } from './slug'

describe('slugify', () => {
  it('normaliza nome com acentos e espaços', () => {
    expect(slugify('Minha Organização')).toBe('minha-organizacao')
  })
  it('remove símbolos e colapsa hífens', () => {
    expect(slugify('  A&B  Envios!! ')).toBe('a-b-envios')
  })
  it('vazio vira string vazia', () => {
    expect(slugify('')).toBe('')
  })
})
