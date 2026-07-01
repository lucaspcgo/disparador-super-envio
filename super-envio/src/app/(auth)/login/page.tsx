import { login } from '../actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>
}) {
  const { error, message } = await searchParams
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form action={login} className="w-full max-w-sm space-y-4 rounded-xl border p-6">
        <h1 className="text-xl font-semibold">Entrar no Super Envio</h1>
        {message && <p className="text-sm text-green-600">{message}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <input name="email" type="email" required placeholder="E-mail" className="w-full rounded border px-3 py-2" />
        <input name="password" type="password" required placeholder="Senha" className="w-full rounded border px-3 py-2" />
        <button className="w-full rounded bg-black py-2 text-white">Entrar</button>
        <a href="/signup" className="block text-center text-sm text-gray-600">Criar conta</a>
      </form>
    </main>
  )
}
