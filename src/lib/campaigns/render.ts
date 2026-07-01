export function renderMessage(
  template: string, vars: Record<string, string>, rng: () => number = Math.random,
): string {
  // spintax: {a|b|c} → escolhe uma
  const spun = template.replace(/\{([^{}]*\|[^{}]*)\}/g, (_m, group: string) => {
    const opts = group.split('|')
    return opts[Math.min(opts.length - 1, Math.floor(rng() * opts.length))]
  })
  // variáveis: {{chave}}
  return spun.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '')
}
