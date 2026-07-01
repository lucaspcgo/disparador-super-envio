import { signup } from '../actions'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form action={signup} className="w-full max-w-sm space-y-4 rounded-xl border p-6">
        <h1 className="text-xl font-semibold">Criar conta</h1>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <input name="full_name" placeholder="Seu nome" className="w-full rounded border px-3 py-2" />
        <input name="org_name" placeholder="Nome da empresa" className="w-full rounded border px-3 py-2" />
        <input name="email" type="email" required placeholder="E-mail" className="w-full rounded border px-3 py-2" />
        <input name="password" type="password" required minLength={6} placeholder="Senha" className="w-full rounded border px-3 py-2" />
        <button className="w-full rounded bg-black py-2 text-white">Cadastrar</button>
        <a href="/login" className="block text-center text-sm text-gray-600">Já tenho conta</a>
      </form>
    </main>
  )
}
