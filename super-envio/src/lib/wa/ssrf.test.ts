import { describe, it, expect } from 'vitest'
import { isBlockedIp, assertPublicHttpUrl } from './ssrf'

describe('isBlockedIp', () => {
  it('bloqueia IPv4 internos/reservados', () => {
    for (const ip of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '224.0.0.1'])
      expect(isBlockedIp(ip)).toBe(true)
  })
  it('permite IPv4 públicos', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34'])
      expect(isBlockedIp(ip)).toBe(false)
  })
  it('bloqueia IPv6 internos e mapeados', () => {
    for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12::1', 'ff02::1', '::ffff:127.0.0.1'])
      expect(isBlockedIp(ip)).toBe(true)
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false)
  })
})

describe('assertPublicHttpUrl', () => {
  it('rejeita URL inválida', async () => {
    await expect(assertPublicHttpUrl('nao-e-url')).rejects.toThrow(/inválida/i)
  })
  it('rejeita scheme não-http', async () => {
    await expect(assertPublicHttpUrl('ftp://example.com')).rejects.toThrow(/http/i)
  })
  it('rejeita host que resolve para IP interno', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1:8080')).rejects.toThrow(/não permitido/i)
  })
  it('aceita host público (IP literal)', async () => {
    await expect(assertPublicHttpUrl('https://8.8.8.8')).resolves.toBeUndefined()
  })
})
