import { login } from '../actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>
}) {
  const { error, message } = await searchParams
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-brand)] text-white">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="6" cy="18" r="2" fill="currentColor" stroke="none" />
              <path d="M6 11a11 11 0 0 1 11 11" />
              <path d="M6 4a18 18 0 0 1 18 18" opacity="0.55" />
            </svg>
          </span>
          <span className="font-[family-name:var(--font-display)] text-[17px] font-bold tracking-tight">
            Super Envio
          </span>
        </div>

        <form action={login} className="card space-y-4 p-6">
          <div>
            <h1 className="page-title text-xl">Entrar no Super Envio</h1>
            <p className="muted mt-1 text-sm">Entre para gerenciar seus disparos</p>
          </div>
          {message && <p className="text-sm text-[var(--color-ok)]">{message}</p>}
          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
          <div>
            <label className="label" htmlFor="login-email">E-mail</label>
            <input id="login-email" name="email" type="email" required placeholder="E-mail" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="login-password">Senha</label>
            <input id="login-password" name="password" type="password" required placeholder="Senha" className="input" />
          </div>
          <button className="btn btn-primary w-full">Entrar</button>
          <a href="/signup" className="block text-center text-sm muted">Criar conta</a>
        </form>
      </div>
    </main>
  )
}
