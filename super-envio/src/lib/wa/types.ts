export type Provider = 'evolution_byo' | 'evolution_managed' | 'meta_cloud'

export type ConnState = {
  status: 'connecting' | 'connected' | 'disconnected'
  qr?: string
  phoneNumber?: string
}

export interface WhatsAppGateway {
  readonly provider: Provider
  ensureConnection(): Promise<ConnState>
  getConnectionState(): Promise<ConnState>
  disconnect(): Promise<void>
  sendText(to: string, body: string): Promise<{ providerMessageId: string }>
  sendTemplate(to: string, name: string, vars: string[]): Promise<{ providerMessageId: string }>
}

// Linha (não-secreta) de whatsapp_instances usada pela factory/UI.
export type InstanceRow = {
  id: string
  organization_id: string
  provider: Provider
  name: string
  status: ConnState['status']
  phone_number: string | null
  evolution_instance_name: string | null
  meta_phone_number_id: string | null
  meta_waba_id: string | null
  hourly_limit: number
  daily_limit: number
  warmup_level: number
}

// Segredo cifrado no Vault (formato por provedor).
export type Credential =
  | { baseUrl: string; apiKey: string }   // evolution_byo | evolution_managed
  | { accessToken: string }               // meta_cloud
