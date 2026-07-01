// Normaliza telefone para E.164. Foco Brasil (default 55); aceita internacional com '+'.
export function normalizePhoneBR(raw: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const hadPlus = trimmed.startsWith('+')
  let digits = trimmed.replace(/\D/g, '')
  if (!digits) return null

  if (hadPlus) {
    // Já internacional: valida faixa de tamanho E.164 (8–15 dígitos).
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  }

  // Remove zero de operadora à esquerda (ex.: 011...).
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '')

  // Já tem código do país 55 + (10 ou 11) dígitos nacionais.
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`
  }
  // Número nacional: DDD (2) + 8 ou 9 dígitos = 10 ou 11.
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`
  }
  return null
}
