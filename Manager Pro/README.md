# 🧩 Manager Pro — Extensão Chrome

Extensão para o Google Chrome que permite acessar o **Manager Pro** (Evolution API) diretamente pelo navegador, com um clique no ícone da extensão.

---

## 📁 Estrutura da Extensão

```
Extensão/
├── manifest.json        → Manifesto V3 do Chrome
├── background.js        → Service Worker (controla o clique no ícone)
├── icons/
│   ├── icon16.png       → Ícone 16x16
│   ├── icon48.png       → Ícone 48x48
│   └── icon128.png      → Ícone 128x128
├── assets/              → Build compilado da aplicação
│   ├── index-*.css
│   └── index-*.js
├── index.html           → Arquivo principal da aplicação
└── README.md            → Este arquivo
```

---

## 🔨 Como Buildar a Extensão

### Pré-requisitos

- Node.js 18+
- npm 8+
- Dependências instaladas (`npm install`)

### Comando de Build

Na raiz do projeto, execute:

```bash
npm run build:extension
```

Isso irá:
1. Compilar o TypeScript
2. Buildar a aplicação com o Vite usando caminhos relativos (`./`)
3. Gerar os arquivos diretamente na pasta `Extensão/`

> **Nota:** O build da extensão usa `createHashRouter` em vez de `createBrowserRouter`, pois a History API não funciona dentro de extensões Chrome. Isso é controlado automaticamente pela variável `VITE_CHROME_EXTENSION`.

### Script PowerShell (alternativo)

Também é possível usar o script com saída visual:

```powershell
.\build-extension.ps1
```

---

## 🚀 Como Instalar no Chrome

### 1. Abrir a página de extensões

Digite na barra de endereço do Chrome:

```
chrome://extensions
```

### 2. Ativar o Modo do Desenvolvedor

No canto superior direito da página, ative o toggle **"Modo do desenvolvedor"**.

### 3. Carregar a extensão

Clique no botão **"Carregar sem compactação"** (Load unpacked).

### 4. Selecionar a pasta

Navegue até a pasta `Extensão` dentro do projeto e selecione-a.

### 5. Pronto!

O ícone do **Manager Pro** aparecerá na barra de extensões do Chrome. Clique nele para abrir a aplicação em uma nova aba.

---

## 🖱️ Como Funciona

- **Clique no ícone** → Abre uma nova aba com a aplicação completa
- **Se a aba já estiver aberta** → Foca na aba existente em vez de criar uma nova

---

## 🔄 Como Atualizar

Após fazer alterações no código:

1. Execute `npm run build:extension`
2. Vá em `chrome://extensions`
3. Clique no botão de **recarregar** (🔄) na extensão Manager Pro

---

## ⚠️ Solução de Problemas

### A extensão não carrega

- Verifique se a pasta `Extensão/` contém o `index.html` e a pasta `assets/`
- Execute `npm run build:extension` novamente

### Tela em branco ao abrir

- Abra o DevTools da janela da extensão (clique direito → Inspecionar)
- Verifique o console para erros
- Certifique-se de que o build foi feito com o comando correto (`build:extension`, não `build`)

### Erro de CSP (Content Security Policy)

- Se a API do Evolution estiver em um domínio diferente, as permissões `host_permissions` no `manifest.json` já cobrem `https://*/*` e `http://*/*`
- Se usar WebSocket, `ws:` e `wss:` também estão permitidos na CSP

### As rotas não funcionam

- A extensão usa `HashRouter` automaticamente (URLs com `#`)
- Isso é normal e necessário para funcionar dentro do Chrome