import { describe, it, expect } from 'vitest'
import { parseContactsCsv } from './csv'

describe('parseContactsCsv', () => {
  it('parseia cabeçalho, normaliza telefone e mapeia custom', () => {
    const csv = 'nome,telefone,cidade\nAna,(11) 99999-8888,SP\nBruno,11888887777,RJ'
    const { rows, errors } = parseContactsCsv(csv)
    expect(errors).toEqual([])
    expect(rows).toEqual([
      { phone: '+5511999998888', name: 'Ana', custom: { cidade: 'SP' } },
      { phone: '+5511888887777', name: 'Bruno', custom: { cidade: 'RJ' } },
    ])
  })
  it('linha com telefone inválido vai para errors', () => {
    const csv = 'telefone,nome\n123,X\n11999998888,Y'
    const { rows, errors } = parseContactsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Y')
    expect(errors).toHaveLength(1)
  })
  it('dedupe por telefone no arquivo (mantém primeiro)', () => {
    const csv = 'telefone,nome\n11999998888,Ana\n(11)99999-8888,Ana2'
    const { rows } = parseContactsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Ana')
  })
  it('sem coluna de telefone → erro geral', () => {
    const { rows, errors } = parseContactsCsv('nome,cidade\nAna,SP')
    expect(rows).toHaveLength(0)
    expect(errors.length).toBeGreaterThan(0)
  })
})
