<p align="center">
  <img src="../../assets/icon-512.png" width="120" alt="Stellara Work" />
</p>

<h1 align="center">Stellara Work</h1>

<p align="center">
  <strong>Agente de escritorio local-first al estilo Codex</strong> para Windows y macOS.<br/>
  Use su propia clave API compatible con OpenAI — todos los datos permanecen en su máquina.
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README_zh-TW.md">繁體中文</a> · <a href="README_ru.md">Русский</a> · <a href="README_fr.md">Français</a> · <a href="README_de.md">Deutsch</a> · <a href="README_es.md">Español</a> · <a href="README_pt-BR.md">Português</a> · <a href="README_ja.md">日本語</a> · <a href="README_ko.md">한국어</a> · <a href="README_ar.md">العربية</a>
</p>

---

**Stellara Work** es un agente de escritorio **local-first** que funciona como un Codex personal. Use su propia clave API compatible con OpenAI (`base_url + api_key`) y colabore con el agente en su estación de trabajo para tareas de codificación: leer archivos, editar código, ejecutar comandos; todo revisable y aprobable.

La clave API, sesiones, archivos y configuración **nunca abandonan su máquina**. Stellara Work no envía datos a servidores externos.

---

## Características destacadas

| | Característica | Descripción |
|---|---|---|
| 🔒 | **Privacidad local优先** | La clave API se cifra con el Llavero del sistema (macOS) / DPAPI (Windows); todos los datos se almacenan localmente |
| 🧠 | **Modelos propios** | Compatible con cualquier endpoint compatible con OpenAI; preajustes integrados para GLM, DeepSeek, Kimi, MiniMax; modelos personalizados ilimitados |
| ✅ | **Modo planificación + puerta de aprobación** | Cada escritura de archivo y ejecución de comando requiere su aprobación explícita |
| 💬 | **Conversación en streaming** | Renderizado Markdown en tiempo real, vista diff y tarjetas de salida de comandos |
| 🗂️ | **Área de trabajo del proyecto** | Apunte a cualquier carpeta; el agente lee, escribe y verifica en código real |
| 🧰 | **Habilidades y MCP** | Extienda las capacidades del agente con habilidades personalizadas y servidores MCP |
| 🧠 | **Centro de memoria** | Memoria persistente y buscable entre sesiones |
| 📎 | **Adjuntos** | Arrastre archivos e imágenes en cualquier sesión |
| 📂 | **Administrador de archivos** | Árbol de archivos en la barra lateral con creación de archivos/carpetas |
| 🎨 | **Sistema de diseño** | Variables de estilo UI unificadas y diseño de escritorio |

---

## Capturas de pantalla

| Inicio | Chat | Configuración |
|:---:|:---:|:---:|
| ![Inicio](../../assets/screenshots/home.png) | ![Chat](../../assets/screenshots/chat.png) | ![Configuración](../../assets/screenshots/settings.png) |

---

## Descarga

**Última versión: v0.9.1**

| Plataforma | Instalador |
|---|---|
| macOS (Apple Silicon) | [Stellara Work-0.9.1-arm64.dmg](https://github.com/strashineltd/stellara-work/releases/latest) |
| Windows (x64) | [Stellara Work-Setup-0.9.1.exe](https://github.com/strashineltd/stellara-work/releases/latest) |

> **Nota:** Los instaladores actuales no están firmados. En macOS, haga clic derecho → Abrir; en Windows, seleccione "Más información → Ejecutar de todos modos" en SmartScreen.

---

## Inicio rápido

### Requisitos previos

- Node.js 20+
- Windows: Python 3.x + Visual Studio Build Tools (C++ para desarrollo de escritorio) — solo necesario para la primera `npm install`
- macOS / Linux: No se requiere nada adicional

### 1. Instalar dependencias

```bash
npm install
```

En macOS/Linux puede usar `bash setup.sh` (verifica Node, instala dependencias, ejecuta pruebas).

### 2. Iniciar

```bash
npm run dev
```

En el primer inicio, siga la guía para seleccionar un modelo e ingresar la clave API. La clave se cifra y almacena, solo accesible por el proceso principal.

### 3. Scripts útiles

```bash
npm run dev          # Modo desarrollo (Vite HMR + Electron)
npm test             # Ejecutar pruebas
npm run typecheck    # Verificación de tipos para ambos procesos
npm run package:mac  # Construir dmg/zip para macOS (solo macOS)
npm run package:win  # Construir instalador NSIS para Windows
```

---

## Modelos preajustados integrados

| Modelo | Proveedor | base_url |
|---|---|---|
| GLM-5.2 | ZhiPu AI | `https://open.bigmodel.cn/api/paas/v4` |
| DeepSeek-v4-Pro | DeepSeek | `https://api.deepseek.com` |
| Kimi-K3 | Moonshot | `https://api.moonshot.cn` |
| MiniMax-M3 | MiniMax | `https://api.minimaxi.com/v1` |
| Personalizado | Su propio | Cualquier endpoint compatible con OpenAI |

---

## Modelo de seguridad

- `nodeIntegration: false` — El proceso de renderizado no puede usar `require('fs')`
- `contextIsolation: true` — El JS del proceso de renderizado está aislado del preload
- `sandbox: true` — El proceso de renderizado se ejecuta en aislamiento (sandbox)
- URLs externas limitadas al protocolo `http/https/mailto`
- Todos los handlers IPC verifican el origen del remitente
- Todas las operaciones peligrosas (escritura de archivos, ejecución de comandos) requieren aprobación explícita

---

## Arquitectura

```
electron/                  # Proceso principal de Electron
├── main.ts                # Punto de entrada + handlers IPC
├── preload.ts             # API contextBridge
├── agent/                 # Bucle del agente, planificación, herramientas (fs / shell / grep / git)
├── llm/                   # Cliente compatible con OpenAI + streaming SSE
├── memory/                # Almacenamiento de memoria persistente
└── config/                # Almacenamiento de claves cifradas (safeStorage)
src/                       # Proceso de renderizado React
├── components/            # Chat, tarjetas de plan, configuración, guía, inicio
├── styles/                # Variables de diseño + CSS del escritorio
└── lib/                   # Utilidades del proceso de renderizado
shared/                    # Contratos IPC compartidos entre procesos
```

Stack tecnológico: Electron · React 19 · TypeScript · Vite · better-sqlite3 · CodeMirror 6

---

## Documentación

- [Guía de migración a macOS](../macos-migration.md)
- [Guía de contribución](../../CONTRIBUTING.md)
- [Registro de cambios](../../CHANGELOG.md)

---

## Licencia

[MIT](../../LICENSE) © Stellara Work