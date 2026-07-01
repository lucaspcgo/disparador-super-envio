import { describe, it, expect, vi, afterEach } from 'vitest'
import { MetaCloudGateway } from './meta'

function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const { status = 200, body } = handler(url, init)
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
  })
}
afterEach(() => vi.unstubAllGlobals())

describe('MetaCloudGateway', () => {
  it('getConnectionState=connected valida token e lê telefone', async () => {
    vi.stubGlobal('fetch', mockFetch((url, init) => {
      expect(url).toContain('/PNID?fields=display_phone_number,verified_name')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOK')
      return { body: { display_phone_number: '+55 11 99999-8888', verified_name: 'Loja' } }
    }))
    const gw = new MetaCloudGateway('PNID', 'TOK')
    expect(gw.provider).toBe('meta_cloud')
    expect(await gw.getConnectionState()).toEqual({ status: 'connected', phoneNumber: '+55 11 99999-8888' })
  })

  it('getConnectionState=disconnected quando token inválido', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ status: 401, body: { error: {} } })))
    const gw = new MetaCloudGateway('PNID', 'BAD')
    expect(await gw.getConnectionState()).toEqual({ status: 'disconnected' })
  })

  it('sendText monta payload de texto e retorna id', async () => {
    let sent: unknown
    vi.stubGlobal('fetch', mockFetch((url, init) => {
      expect(url).toContain('/PNID/messages')
      sent = JSON.parse(init.body as string)
      return { body: { messages: [{ id: 'wamid.ABC' }] } }
    }))
    const gw = new MetaCloudGateway('PNID', 'TOK')
    const r = await gw.sendText('5511999998888', 'oi')
    expect(sent).toEqual({ messaging_product: 'whatsapp', to: '5511999998888', type: 'text', text: { body: 'oi' } })
    expect(r.providerMessageId).toBe('wamid.ABC')
  })

  it('sendTemplate monta componentes de parâmetros posicionais', async () => {
    let sent: any
    vi.stubGlobal('fetch', mockFetch((_url, init) => {
      sent = JSON.parse(init.body as string)
      return { body: { messages: [{ id: 'wamid.T' }] } }
    }))
    const gw = new MetaCloudGateway('PNID', 'TOK')
    const r = await gw.sendTemplate('5511999998888', 'boas_vindas', ['Ana', 'Premium'])
    expect(sent.type).toBe('template')
    expect(sent.template.name).toBe('boas_vindas')
    expect(sent.template.components[0]).toEqual({
      type: 'body',
      parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: 'Premium' }],
    })
    expect(r.providerMessageId).toBe('wamid.T')
  })
})
