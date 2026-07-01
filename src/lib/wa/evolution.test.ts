import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EvolutionClient, EvolutionGateway, mapEvolutionState, provisionManagedInstance, deleteManagedInstance } from './evolution'

function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const { status = 200, body } = handler(url, init)
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
  })
}

beforeEach(() => { vi.stubGlobal('fetch', mockFetch(() => ({ body: {} }))) })
afterEach(() => { vi.unstubAllGlobals() })

describe('mapEvolutionState', () => {
  it('mapeia estados da Evolution', () => {
    expect(mapEvolutionState('open')).toBe('connected')
    expect(mapEvolutionState('connecting')).toBe('connecting')
    expect(mapEvolutionState('close')).toBe('disconnected')
  })
})

describe('EvolutionClient', () => {
  it('envia apikey no header e faz GET no connectionState', async () => {
    const fetchMock = mockFetch((url) => {
      expect(url).toBe('https://ev.example.com/instance/connectionState/inst1')
      return { body: { instance: { instanceName: 'inst1', state: 'open' } } }
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new EvolutionClient('https://ev.example.com', 'KEY123')
    const r = await client.connectionState('inst1')
    expect(r.instance.state).toBe('open')
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers)
      .toMatchObject({ apikey: 'KEY123' })
  })

  it('sendText faz POST com {number,text}', async () => {
    let sentBody: unknown
    const fetchMock = mockFetch((url, init) => {
      expect(url).toBe('https://ev.example.com/message/sendText/inst1')
      sentBody = JSON.parse(init.body as string)
      return { body: { key: { id: 'MSG-1' } } }
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new EvolutionClient('https://ev.example.com', 'KEY123')
    const r = await client.sendText('inst1', '5511999998888', 'oi')
    expect(sentBody).toEqual({ number: '5511999998888', text: 'oi' })
    expect(r.key.id).toBe('MSG-1')
  })

  it('lança erro em resposta não-ok', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ status: 401, body: { error: 'Unauthorized' } })))
    const client = new EvolutionClient('https://ev.example.com', 'BAD')
    await expect(client.connectionState('inst1')).rejects.toThrow(/401/)
  })
})

describe('EvolutionGateway', () => {
  it('ensureConnection retorna connected quando state=open', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ body: { instance: { state: 'open' } } })))
    const gw = new EvolutionGateway(new EvolutionClient('https://ev', 'K'), 'inst1', 'evolution_byo')
    expect(gw.provider).toBe('evolution_byo')
    expect(await gw.ensureConnection()).toEqual({ status: 'connected' })
  })

  it('ensureConnection retorna QR quando desconectado', async () => {
    vi.stubGlobal('fetch', mockFetch((url) => {
      if (url.includes('/connectionState/')) return { body: { instance: { state: 'close' } } }
      return { body: { base64: 'data:image/png;base64,QRQR', code: '2@abc' } }
    }))
    const gw = new EvolutionGateway(new EvolutionClient('https://ev', 'K'), 'inst1', 'evolution_managed')
    expect(await gw.ensureConnection()).toEqual({ status: 'connecting', qr: 'data:image/png;base64,QRQR' })
  })

  it('sendTemplate lança erro (Evolution não suporta)', async () => {
    const gw = new EvolutionGateway(new EvolutionClient('https://ev', 'K'), 'inst1', 'evolution_byo')
    await expect(gw.sendTemplate('x', 'y', [])).rejects.toThrow(/template/i)
  })
})

describe('provisionManagedInstance', () => {
  afterEach(() => {
    delete process.env.EVOLUTION_MANAGED_URL
    delete process.env.EVOLUTION_MANAGED_GLOBAL_KEY
  })

  it('lança se env do host gerenciado não configurado', async () => {
    delete process.env.EVOLUTION_MANAGED_URL
    delete process.env.EVOLUTION_MANAGED_GLOBAL_KEY
    await expect(provisionManagedInstance('inst1')).rejects.toThrow(/EVOLUTION_MANAGED/)
  })

  it('cria instância com hash string e retorna apiKey + qr (base64)', async () => {
    process.env.EVOLUTION_MANAGED_URL = 'https://managed.example.com'
    process.env.EVOLUTION_MANAGED_GLOBAL_KEY = 'GLOBAL'
    const fetchMock = mockFetch((url, init) => {
      expect(url).toBe('https://managed.example.com/instance/create')
      expect((init.headers as Record<string, string>).apikey).toBe('GLOBAL')
      return { body: { hash: 'INSTKEY', qrcode: { base64: 'QR1' } } }
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await provisionManagedInstance('inst1')).toEqual({ apiKey: 'INSTKEY', qr: 'QR1' })
  })

  it('aceita hash como objeto {apikey} e usa code do qr', async () => {
    process.env.EVOLUTION_MANAGED_URL = 'https://managed.example.com'
    process.env.EVOLUTION_MANAGED_GLOBAL_KEY = 'GLOBAL'
    vi.stubGlobal('fetch', mockFetch(() => ({ body: { hash: { apikey: 'INSTKEY2' }, qrcode: { code: 'QRCODE' } } })))
    expect(await provisionManagedInstance('inst2')).toEqual({ apiKey: 'INSTKEY2', qr: 'QRCODE' })
  })

  it('lança se a Evolution não retornar apikey', async () => {
    process.env.EVOLUTION_MANAGED_URL = 'https://managed.example.com'
    process.env.EVOLUTION_MANAGED_GLOBAL_KEY = 'GLOBAL'
    vi.stubGlobal('fetch', mockFetch(() => ({ body: { hash: {} } })))
    await expect(provisionManagedInstance('inst3')).rejects.toThrow(/apikey/i)
  })
})

describe('deleteManagedInstance', () => {
  afterEach(() => {
    delete process.env.EVOLUTION_MANAGED_URL
    delete process.env.EVOLUTION_MANAGED_GLOBAL_KEY
  })

  it('faz DELETE na instância no host gerenciado', async () => {
    process.env.EVOLUTION_MANAGED_URL = 'https://managed.example.com'
    process.env.EVOLUTION_MANAGED_GLOBAL_KEY = 'GLOBAL'
    let called = ''
    vi.stubGlobal('fetch', mockFetch((url, init) => { called = `${init.method} ${url}`; return { body: {} } }))
    await deleteManagedInstance('inst1')
    expect(called).toBe('DELETE https://managed.example.com/instance/delete/inst1')
  })
})
