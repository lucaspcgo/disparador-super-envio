import { lookup } from 'node:dns/promises'

// Bloqueia IPs não-roteáveis/internos para mitigar SSRF em URLs fornecidas pelo usuário (Evolution BYO).
export function isBlockedIp(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase()
    if (v === '::1' || v === '::') return true
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isBlockedIp(mapped[1])
    if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true // link-local fe80::/10
    if (v.startsWith('fc') || v.startsWith('fd')) return true // ULA fc00::/7
    if (v.startsWith('ff')) return true // multicast
    return false
  }
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 0) return true                         // 0.0.0.0/8
  if (a === 10) return true                        // 10/8
  if (a === 127) return true                       // loopback
  if (a === 169 && b === 254) return true          // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
  if (a === 192 && b === 168) return true          // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a >= 224) return true                        // multicast/reservado
  return false
}

// Valida que a URL usa http(s) e que o host resolve apenas para IPs públicos.
export async function assertPublicHttpUrl(raw: string): Promise<void> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('URL inválida')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL deve usar http ou https')
  }
  const results = await lookup(url.hostname, { all: true })
  if (results.length === 0) throw new Error('host não resolvido')
  for (const { address } of results) {
    if (isBlockedIp(address)) throw new Error('host de destino não permitido')
  }
}
