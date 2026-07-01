# syntax=docker/dockerfile:1
# Build de produção do Next.js 16 (output standalone) para EasyPanel/Docker.

# ---- deps: instala dependências ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: compila o app ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# As NEXT_PUBLIC_* são embutidas no bundle EM BUILD TIME → precisam existir aqui.
# O EasyPanel passa estes valores como --build-arg.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---- runner: imagem final mínima ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Usuário não-root
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Artefatos do build standalone
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# server.js é gerado pelo output standalone do Next.
# Variáveis SERVER-ONLY (SUPABASE_SERVICE_ROLE_KEY, EVOLUTION_*) são injetadas
# em RUNTIME pelo EasyPanel — não precisam estar na imagem.
CMD ["node", "server.js"]
