import type { ConnState, WhatsAppGateway } from './types'

export const META_API_VERSION = 'v21.0'

export class MetaCloudGateway implements WhatsAppGateway {
  readonly provider = 'meta_cloud' as const
  private base = `https://graph.facebook.com/${META_API_VERSION}`

  constructor(private phoneNumberId: string, private accessToken: string) {}

  private async req(path: string, method = 'GET', body?: unknown) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Meta API ${res.status} em ${method} ${path}`)
    return res.json()
  }

  async ensureConnection(): Promise<ConnState> {
    return this.getConnectionState()
  }

  async getConnectionState(): Promise<ConnState> {
    try {
      const r = await this.req(`/${this.phoneNumberId}?fields=display_phone_number,verified_name`)
      return { status: 'connected', phoneNumber: r.display_phone_number }
    } catch {
      return { status: 'disconnected' }
    }
  }

  async disconnect(): Promise<void> {
    // Meta Cloud: não há sessão para encerrar; desconexão é lógica (remover instância).
  }

  async sendText(to: string, body: string) {
    const r = await this.req(`/${this.phoneNumberId}/messages`, 'POST', {
      messaging_product: 'whatsapp', to, type: 'text', text: { body },
    })
    return { providerMessageId: r.messages[0].id }
  }

  async sendTemplate(to: string, name: string, vars: string[]) {
    const components = vars.length
      ? [{ type: 'body', parameters: vars.map((v) => ({ type: 'text', text: v })) }]
      : []
    const r = await this.req(`/${this.phoneNumberId}/messages`, 'POST', {
      messaging_product: 'whatsapp', to, type: 'template',
      template: { name, language: { code: 'pt_BR' }, components },
    })
    return { providerMessageId: r.messages[0].id }
  }
}
