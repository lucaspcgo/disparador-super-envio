import { signup } from '../actions'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
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

        <form action={signup} className="card space-y-4 p-6">
          <div>
            <h1 className="page-title text-xl">Criar conta</h1>
            <p className="muted mt-1 text-sm">Crie sua conta e comece a disparar</p>
          </div>
          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
          <div>
            <label className="label" htmlFor="signup-name">Seu nome</label>
            <input id="signup-name" name="full_name" placeholder="Seu nome" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="signup-org">Nome da empresa</label>
            <input id="signup-org" name="org_name" placeholder="Nome da empresa" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="signup-email">E-mail</label>
            <input id="signup-email" name="email" type="email" required placeholder="E-mail" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="signup-password">Senha</label>
            <input id="signup-password" name="password" type="password" required minLength={6} placeholder="Mínimo 6 caracteres" className="input" />
          </div>
          <button className="btn btn-primary w-full">Cadastrar</button>
          <a href="/login" className="block text-center text-sm muted">Já tenho conta</a>
        </form>
      </div>
    </main>
  )
}
