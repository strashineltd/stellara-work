<p align="center">
  <img src="../../assets/icon-512.png" width="120" alt="Stellara Work" />
</p>

<h1 align="center">Stellara Work</h1>

<p align="center">
  <strong>Agente desktop local-first no estilo Codex</strong> para Windows e macOS.<br/>
  Use sua própria chave API compatível com OpenAI — todos os dados permanecem na sua máquina.
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README_zh-TW.md">繁體中文</a> · <a href="README_ru.md">Русский</a> · <a href="README_fr.md">Français</a> · <a href="README_de.md">Deutsch</a> · <a href="README_es.md">Español</a> · <a href="README_pt-BR.md">Português</a> · <a href="README_ja.md">日本語</a> · <a href="README_ko.md">한국어</a> · <a href="README_ar.md">العربية</a>
</p>

---

**Stellara Work** é um agente desktop **local-first** que funciona como um Codex pessoal. Use sua própria chave API compatível com OpenAI (`base_url + api_key`) e colabore com o agente em sua estação de trabalho para tarefas de codificação: ler arquivos, editar código, executar comandos — tudo revisável e aprovável.

A chave API, sessões, arquivos e configuração **nunca saem da sua máquina**. Stellara Work não envia dados para servidores externos.

---

## Recursos em destaque

| | Recurso | Descrição |
|---|---|---|
| 🔒 | **Privacidade local** | A chave API é criptografada com o Keychain do sistema (macOS) / DPAPI (Windows); todos os dados são armazenados localmente |
| 🧠 | **Modelos próprios** | Compatível com qualquer endpoint compatível com OpenAI; predefinições integradas para GLM, DeepSeek, Kimi, MiniMax; modelos personalizados ilimitados |
| ✅ | **Modo planejamento + porta de aprovação** | Cada escrita de arquivo e execução de comando requer sua aprovação explícita |
| 💬 | **Conversa em streaming** | Renderização Markdown em tempo real, visualização diff e cartões de saída de comandos |
| 🗂️ | **Área de trabalho do projeto** | Aponte para qualquer pasta; o agente lê, escreve e verifica em código real |
| 🧰 | **Habilidades e MCP** | Estenda as capacidades do agente com habilidades personalizadas e servidores MCP |
| 🧠 | **Central de memória** | Memória persistente e pesquisável entre sessões |
| 📎 | **Anexos** | Arraste arquivos e imagens em qualquer sessão |
| 📂 | **Gerenciador de arquivos** | Árvore de arquivos na barra lateral com criação de arquivos/pastas |
| 🎨 | **Sistema de design** | Variáveis de estilo UI unificadas e design de estação de trabalho |

---

## Capturas de tela

| Início | Chat | Configurações |
|:---:|:---:|:---:|
| ![Início](../../assets/screenshots/home.png) | ![Chat](../../assets/screenshots/chat.png) | ![Configurações](../../assets/screenshots/settings.png) |

---

## Download

**Versão mais recente: v0.9.1**

| Plataforma | Instalador |
|---|---|
| macOS (Apple Silicon) | [Stellara Work-0.9.1-arm64.dmg](https://github.com/strashineltd/stellara-work/releases/latest) |
| Windows (x64) | [Stellara Work-Setup-0.9.1.exe](https://github.com/strashineltd/stellara-work/releases/latest) |

> **Nota:** Os instaladores atuais não estão assinados. No macOS, clique com o botão direito → Abrir; no Windows, selecione "Mais informações → Executar mesmo assim" no SmartScreen.

---

## Início rápido

### Requisitos prévios

- Node.js 20+
- Windows: Python 3.x + Visual Studio Build Tools (C++ para desenvolvimento desktop) — necessário apenas para a primeira `npm install`
- macOS / Linux: Não é necessário nada adicional

### 1. Instalar dependências

```bash
npm install
```

No macOS/Linux você pode usar `bash setup.sh` (verifica Node, instala dependências, executa testes).

### 2. Iniciar

```bash
npm run dev
```

Na primeira inicialização, siga o guia para selecionar um modelo e inserir a chave API. A chave é criptografada e armazenada, acessível apenas pelo processo principal.

### 3. Scripts úteis

```bash
npm run dev          # Modo desenvolvimento (Vite HMR + Electron)
npm test             # Executar testes
npm run typecheck    # Verificação de tipos para ambos processos
npm run package:mac  # Construir dmg/zip para macOS (apenas macOS)
npm run package:win  # Construir instalador NSIS para Windows
```

---

## Modelos predefinidos integrados

| Modelo | Provedor | base_url |
|---|---|---|
| GLM-5.2 | ZhiPu AI | `https://open.bigmodel.cn/api/paas/v4` |
| DeepSeek-v4-Pro | DeepSeek | `https://api.deepseek.com` |
| Kimi-K3 | Moonshot | `https://api.moonshot.cn` |
| MiniMax-M3 | MiniMax | `https://api.minimaxi.com/v1` |
| Personalizado | Seu próprio | Qualquer endpoint compatível com OpenAI |

---

## Modelo de segurança

- `nodeIntegration: false` — O processo de renderização não pode usar `require('fs')`
- `contextIsolation: true` — O JS do processo de renderização está isolado do preload
- `sandbox: true` — O processo de renderização é executado em isolamento (sandbox)
- URLs externas limitadas ao protocolo `http/https/mailto`
- Todos os handlers IPC verificam a origem do remetente
- Todas as operações perigosas (escrita de arquivos, execução de comandos) requerem aprovação explícita

---

## Arquitetura

```
electron/                  # Processo principal do Electron
├── main.ts                # Ponto de entrada + handlers IPC
├── preload.ts             # API contextBridge
├── agent/                 # Loop do agente, planejamento, ferramentas (fs / shell / grep / git)
├── llm/                   # Cliente compatível com OpenAI + streaming SSE
├── memory/                # Armazenamento de memória persistente
└── config/                # Armazenamento de chaves criptografadas (safeStorage)
src/                       # Processo de renderização React
├── components/            # Chat, cartões de plano, configurações, guia, início
├── styles/                # Variáveis de design + CSS da estação de trabalho
└── lib/                   # Utilitários do processo de renderização
shared/                    # Contratos IPC compartilhados entre processos
```

Stack tecnológico: Electron · React 19 · TypeScript · Vite · better-sqlite3 · CodeMirror 6

---

## Documentação

- [Guia de migração para macOS](../macos-migration.md)
- [Guia de contribuição](../../CONTRIBUTING.md)
- [Registro de alterações](../../CHANGELOG.md)

---

## Licença

[MIT](../../LICENSE) © Stellara Work