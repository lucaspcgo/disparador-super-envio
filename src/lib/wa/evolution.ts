import type { ConnState, Provider, WhatsAppGateway } from './types'

export class EvolutionClient {
  constructor(private baseUrl: string, private apiKey: string) {}

  private async req(method: string, path: string, body?: unknown) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { apikey: this.apiKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`Evolution API ${res.status} em ${method} ${path}`)
    }
    return res.json()
  }

  connectionState(instance: string): Promise<{ instance: { state: string } }> {
    return this.req('GET', `/instance/connectionState/${instance}`)
  }
  connect(instance: string): Promise<{ base64?: string; code?: string; pairingCode?: string }> {
    return this.req('GET', `/instance/connect/${instance}`)
  }
  sendText(instance: string, number: string, text: string): Promise<{ key: { id: string } }> {
    return this.req('POST', `/message/sendText/${instance}`, { number, text })
  }
  logout(instance: string) {
    return this.req('DELETE', `/instance/logout/${instance}`)
  }
  createInstance(name: string): Promise<{ hash: string | { apikey: string }; qrcode?: { base64?: string; code?: string } }> {
    return this.req('POST', '/instance/create', {
      instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true,
    })
  }
  deleteInstance(instance: string) {
    return this.req('DELETE', `/instance/delete/${instance}`)
  }
}

export function mapEvolutionState(state: string): ConnState['status'] {
  if (state === 'open') return 'connected'
  if (state === 'connecting') return 'connecting'
  return 'disconnected'
}

export class EvolutionGateway implements WhatsAppGateway {
  constructor(
    private client: EvolutionClient,
    private instanceName: string,
    readonly provider: Provider,
  ) {}

  async ensureConnection(): Promise<ConnState> {
    const s = await this.client.connectionState(this.instanceName)
    const status = mapEvolutionState(s.instance.state)
    if (status === 'connected') return { status }
    const q = await this.client.connect(this.instanceName).catch(() => null)
    return { status: 'connecting', qr: q?.base64 ?? q?.code }
  }

  async getConnectionState(): Promise<ConnState> {
    const s = await this.client.connectionState(this.instanceName)
    const status = mapEvolutionState(s.instance.state)
    if (status === 'connected') return { status }
    const q = await this.client.connect(this.instanceName).catch(() => null)
    return { status, qr: q?.base64 ?? q?.code }
  }

  async disconnect(): Promise<void> {
    await this.client.logout(this.instanceName)
  }

  async sendText(to: string, body: string) {
    const r = await this.client.sendText(this.instanceName, to, body)
    return { providerMessageId: r.key.id }
  }

  async sendTemplate(): Promise<{ providerMessageId: string }> {
    throw new Error('Evolution não suporta templates; use sendText')
  }
}

function managedClient(): EvolutionClient {
  const url = process.env.EVOLUTION_MANAGED_URL
  const key = process.env.EVOLUTION_MANAGED_GLOBAL_KEY
  if (!url || !key) throw new Error('EVOLUTION_MANAGED_URL/GLOBAL_KEY não configurados')
  return new EvolutionClient(url, key)
}

export async function provisionManagedInstance(instanceName: string): Promise<{ apiKey: string; qr?: string }> {
  const r = await managedClient().createInstance(instanceName)
  const apiKey = typeof r.hash === 'string' ? r.hash : r.hash?.apikey
  if (!apiKey) throw new Error('Evolution não retornou apikey da instância')
  return { apiKey, qr: r.qrcode?.base64 ?? r.qrcode?.code }
}

export async function deleteManagedInstance(instanceName: string): Promise<void> {
  await managedClient().deleteInstance(instanceName)
}
