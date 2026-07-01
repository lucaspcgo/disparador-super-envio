// Nome determinístico-curto para instância gerenciada (prefixo do id da org + sufixo aleatório).
export function genManagedInstanceName(orgId: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `se-${orgId.slice(0, 8)}-${rand}`
}
