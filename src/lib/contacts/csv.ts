import { normalizePhoneBR } from './phone'

export type ParsedContact = { phone: string; name?: string; custom: Record<string, string> }

const PHONE_KEYS = ['phone', 'telefone', 'celular', 'whatsapp', 'fone', 'numero', 'número']
const NAME_KEYS = ['name', 'nome', 'contato']

function splitLine(line: string): string[] {
  // CSV simples: vírgula ou ponto-e-vírgula; trim de aspas e espaços.
  const sep = line.includes(';') && !line.includes(',') ? ';' : ','
  return line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''))
}

export function parseContactsCsv(text: string): { rows: ParsedContact[]; errors: string[] } {
  const errors: string[] = []
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return { rows: [], errors: ['Arquivo vazio'] }

  const header = splitLine(lines[0]).map((h) => h.toLowerCase())
  const phoneIdx = header.findIndex((h) => PHONE_KEYS.includes(h))
  const nameIdx = header.findIndex((h) => NAME_KEYS.includes(h))
  if (phoneIdx === -1) {
    return { rows: [], errors: ['Nenhuma coluna de telefone encontrada (use "telefone" ou "phone")'] }
  }

  const seen = new Set<string>()
  const rows: ParsedContact[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i])
    const phone = normalizePhoneBR(cols[phoneIdx] ?? '')
    if (!phone) {
      errors.push(`Linha ${i + 1}: telefone inválido ("${cols[phoneIdx] ?? ''}")`)
      continue
    }
    if (seen.has(phone)) continue
    seen.add(phone)
    const custom: Record<string, string> = {}
    header.forEach((h, idx) => {
      if (idx === phoneIdx || idx === nameIdx) return
      const v = cols[idx]
      if (v) custom[h] = v
    })
    rows.push({ phone, name: nameIdx >= 0 ? cols[nameIdx] || undefined : undefined, custom })
  }
  return { rows, errors }
}
