<p align="center">
  <img src="../../assets/icon-512.png" width="120" alt="Stellara Work" />
</p>

<h1 align="center">Stellara Work</h1>

<p align="center">
  <strong>Lokaler Codex-Stil Desktop-Agent</strong> für Windows und macOS.<br/>
  Mit Ihrem eigenen OpenAI-kompatiblen API-Schlüssel — alle Daten verbleiben nur auf Ihrem Gerät.
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README_zh-CN.md">简体中文</a> · <a href="README_zh-TW.md">繁體中文</a> · <a href="README_ru.md">Русский</a> · <a href="README_fr.md">Français</a> · <a href="README_es.md">Español</a> · <a href="README_pt-BR.md">Português</a> · <a href="README_ja.md">日本語</a> · <a href="README_ko.md">한국어</a> · <a href="README_ar.md">العربية</a>
</p>

---

**Stellara Work** ist ein **lokaler** Desktop-Agent, der wie ein persönlicher Codex funktioniert. Verwenden Sie Ihren eigenen OpenAI-kompatiblen API-Schlüssel (`base_url + api_key`), um mit dem Agent auf Ihrem Desktop zusammenzuarbeiten — Dateien lesen, Code bearbeiten, Befehle ausführen — mit Überprüfung und Genehmigung bei jedem Schritt.

API-Schlüssel, Sitzungen, Dateien und Konfigurationen **verlassen niemals Ihr Gerät**. Stellara Work lädt keine Daten auf externe Server hoch.

---

## Hauptfunktionen

| | Funktion | Beschreibung |
|---|---|---|
| 🔒 | **Lokale Privatsphäre** | API-Schlüssel werden über den System-Schlüsselbund (macOS) / DPAPI (Windows) verschlüsselt; alle Daten werden lokal gespeichert |
| 🧠 | **Eigenes Modell** | Kompatibel mit jedem OpenAI-Protokoll-Endpunkt; integrierte Voreinstellungen für GLM, DeepSeek, Kimi, MiniMax; Unterstützung unbegrenzter benutzerdefinierter Modelle |
| ✅ | **Planungsmodus + Genehmigungskontrolle** | Jede Dateischreibung und Befehlsausführung erfordert Ihre ausdrückliche Genehmigung |
| 💬 | **Streaming-Dialog** | Echtzeit-Markdown-Rendering, Diff-Ansicht und Befehlsausgabekarten |
| 🗂️ | **Projekt-Arbeitsbereich** | Verweis auf einen beliebigen Ordner, der Agent liest, schreibt und verifiziert auf dem echten Code |
| 🧰 | **Fähigkeiten und MCP** | Erweiterung der Agent-Fähigkeiten mit benutzerdefinierten Fähigkeiten und MCP-Servern |
| 🧠 | **Gedächtniszentrum** | Persistentes, durchsuchbares Gedächtnis zwischen Sitzungen |
| 📎 | **Anhänge** | Dateien und Bilder per Drag & Drop in jede Sitzung |
| 📂 | **Dateimanager** | Seitenleiste mit Dateibaum, Unterstützung für Datei-/Ordnererstellung |
| 🎨 | **Design-System** | Einheitliche UI-Stilvariablen und Desktop-Design |

---

## Screenshots

| Startseite | Dialog | Einstellungen |
|:---:|:---:|:---:|
| ![Startseite](../../assets/screenshots/home.png) | ![Dialog](../../assets/screenshots/chat.png) | ![Einstellungen](../../assets/screenshots/settings.png) |

---

## Download

**Neueste Version: v0.9.1**

| Plattform | Installationspaket |
|---|---|
| macOS (Apple Silicon) | [Stellara Work-0.9.1-arm64.dmg](https://github.com/strashineltd/stellara-work/releases/latest) |
| Windows (x64) | [Stellara Work-Setup-0.9.1.exe](https://github.com/strashineltd/stellara-work/releases/latest) |

> **Hinweis:** Die aktuellen Installationspakete sind nicht signiert. Unter macOS klicken Sie mit der rechten Maustaste → Öffnen; unter Windows wählen Sie „Weitere Informationen → Trotzdem ausführen" in SmartScreen.

---

## Schnellstart

### Systemanforderungen

- Node.js 20+
- Windows: Python 3.x + Visual Studio Build Tools (Desktop-Entwicklung C++) — nur beim ersten `npm install` erforderlich
- macOS / Linux: keine zusätzliche Installation erforderlich

### 1. Abhängigkeiten installieren

```bash
npm install
```

Unter macOS/Linux können Sie `bash setup.sh` verwenden (Node-Überprüfung, Abhängigkeiten-Installation, Testausführung).

### 2. Starten

```bash
npm run dev
```

Beim ersten Start folgen Sie den Anweisungen zur Modellauswahl und Eingabe des API-Schlüssels. Der Schlüssel wird verschlüsselt und ist nur dem Hauptprozess zugänglich.

### 3. Häufig verwendete Skripte

```bash
npm run dev          # Entwicklungsmodus (Vite HMR + Electron)
npm test             # Tests ausführen
npm run typecheck    # Typüberprüfung für beide Prozesse
npm run package:mac  # macOS dmg/zip erstellen (nur macOS)
npm run package:win  # Windows NSIS-Installationsprogramm erstellen
```

---

## Integrierte Modell-Voreinstellungen

| Modell | Anbieter | base_url |
|---|---|---|
| GLM-5.2 | ZhiPu AI | `https://open.bigmodel.cn/api/paas/v4` |
| DeepSeek-v4-Pro | DeepSeek | `https://api.deepseek.com` |
| Kimi-K3 | Moonshot | `https://api.moonshot.cn` |
| MiniMax-M3 | MiniMax | `https://api.minimaxi.com/v1` |
| Benutzerdefiniert | Ihrer | Beliebiger OpenAI-kompatibler Endpunkt |

---

## Sicherheitsmodell

- `nodeIntegration: false` — der Render-Prozess kann `require('fs')` nicht verwenden
- `contextIsolation: true` — das JS des Render-Prozesses ist vom Preload isoliert
- `sandbox: true` — der Render-Prozess läuft in einer Sandbox
- Externe URL sind auf die Protokolle `http/https/mailto` beschränkt
- Alle IPC-Handler überprüfen die Quelle des Senders
- Alle gefährlichen Operationen (Dateischreibungen, Befehlsausführungen) erfordern eine ausdrückliche Genehmigung

---

## Architektur

```
electron/                  # Electron-Hauptprozess
├── main.ts                # Einstiegspunkt + IPC handlers
├── preload.ts             # contextBridge API
├── agent/                 # Agent-Schleife, Planung, Werkzeuge (fs / shell / grep / git)
├── llm/                   # OpenAI-kompatibler Client + SSE-Streaming
├── memory/                # Persistenter Speicher
└── config/                # Verschlüsselte Schlüsselspeicherung (safeStorage)
src/                       # React-Render-Prozess
├── components/            # Chat, Plankarten, Einstellungen, Anleitung, Startseite
├── styles/                # Design-Variablen + Desktop-CSS
└── lib/                   # Render-Prozess-Utilities
shared/                    # IPC-Verträge, die zwischen Prozessen geteilt werden
```

Technologie-Stack: Electron · React 19 · TypeScript · Vite · better-sqlite3 · CodeMirror 6

---

## Dokumentation

- [macOS-Migrationsanleitung](../macos-migration.md)
- [Beitragsrichtlinien](../../CONTRIBUTING.md)
- [Änderungsprotokoll](../../CHANGELOG.md)

---

## Lizenz

[MIT](../../LICENSE) © Stellara Work
