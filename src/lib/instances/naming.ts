import { randomBytes } from 'node:crypto'

// Nome curto e não-adivinhável para instância gerenciada (CSPRNG): prefixo do id da org + sufixo hex.
export function genManagedInstanceName(orgId: string): string {
  const rand = randomBytes(16).toString('hex').slice(0, 16)
  return `se-${orgId.slice(0, 8)}-${rand}`
}
