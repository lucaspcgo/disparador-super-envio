'use client'

import { usePathname } from 'next/navigation'

type IconProps = { className?: string }

function Logo({ className }: IconProps) {
  // Marca "sinal/envio": ondas de sinal saindo de um ponto.
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="18" r="2" fill="currentColor" stroke="none" />
      <path d="M6 11a11 11 0 0 1 11 11" />
      <path d="M6 4a18 18 0 0 1 18 18" opacity="0.55" />
    </svg>
  )
}
function IconHome({ className }: IconProps) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-5h4v5" /></svg>
}
function IconSignal({ className }: IconProps) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 20a14 14 0 0 1 14-14" opacity="0.5" /><path d="M5 20a9 9 0 0 1 9-9" /><circle cx="5.5" cy="19.5" r="1.6" fill="currentColor" stroke="none" /></svg>
}
function IconUsers({ className }: IconProps) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" opacity="0.6" /><path d="M17 14.5a5.5 5.5 0 0 1 3.5 5.5" opacity="0.6" /></svg>
}
function IconSend({ className }: IconProps) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 3 10.5 13.5" /><path d="M21 3 14.5 21l-4-8-8-4L21 3Z" /></svg>
}

const NAV = [
  { href: '/app', label: 'Painel', exact: true, Icon: IconHome },
  { href: '/app/instancias', label: 'Instâncias', exact: false, Icon: IconSignal },
  { href: '/app/contatos', label: 'Contatos', exact: false, Icon: IconUsers },
  { href: '/app/campanhas', label: 'Campanhas', exact: false, Icon: IconSend },
] as const

export function Sidebar({ orgName, role }: { orgName: string; role: string }) {
  const path = usePathname()
  const isActive = (href: string, exact?: boolean) =>
    exact ? path === href : path === href || path.startsWith(href + '/')

  const links = NAV.map(({ href, label, exact, Icon }) => {
    const active = isActive(href, exact)
    return (
      <a key={href} href={href} className={`se-nav ${active ? 'se-nav-active' : ''}`} aria-current={active ? 'page' : undefined}>
        <Icon className="h-[18px] w-[18px]" />
        <span>{label}</span>
      </a>
    )
  })

  const brand = (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-brand)] text-white">
        <Logo className="h-5 w-5" />
      </span>
      <span className="font-[family-name:var(--font-display)] text-[17px] font-bold tracking-tight text-white">
        Super Envio
      </span>
    </div>
  )

  const footer = (
    <div className="border-t border-white/10 p-3">
      <div className="mb-2 px-1">
        <div className="truncate text-sm font-medium text-white">{orgName}</div>
        <div className="text-xs capitalize text-white/50">{role}</div>
      </div>
      <form action="/auth/signout" method="post">
        <button className="se-nav w-full justify-start text-left" type="submit">
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 17v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" /><path d="M20 12H9" /><path d="m16 8 4 4-4 4" /></svg>
          <span>Sair</span>
        </button>
      </form>
    </div>
  )

  return (
    <>
      {/* Desktop */}
      <aside className="se-sidebar sticky top-0 hidden h-screen w-64 shrink-0 flex-col md:flex">
        <div className="p-5">{brand}</div>
        <nav className="flex flex-1 flex-col gap-1 px-3">{links}</nav>
        {footer}
      </aside>

      {/* Mobile top bar */}
      <div className="se-sidebar sticky top-0 z-20 md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          {brand}
          <form action="/auth/signout" method="post">
            <button className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/80" type="submit">Sair</button>
          </form>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3">
          {NAV.map(({ href, label, exact, Icon }) => {
            const active = isActive(href, exact)
            return (
              <a key={href} href={href} className={`se-nav shrink-0 ${active ? 'se-nav-active' : ''}`}>
                <Icon className="h-[18px] w-[18px]" />
                <span>{label}</span>
              </a>
            )
          })}
        </nav>
      </div>
    </>
  )
}
