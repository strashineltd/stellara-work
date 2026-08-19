<p align="center">
  <img src="../../assets/icon-512.png" width="120" alt="Stellara Work" />
</p>

<h1 align="center">Stellara Work</h1>

<p align="center">
  <strong>Agent de bureau local de style Codex</strong>, compatible Windows et macOS.<br/>
  Avec votre propre clé API compatible OpenAI — toutes les données restent uniquement sur votre appareil.
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README_zh-CN.md">简体中文</a> · <a href="README_zh-TW.md">繁體中文</a> · <a href="README_ru.md">Русский</a> · <a href="README_de.md">Deutsch</a> · <a href="README_es.md">Español</a> · <a href="README_pt-BR.md">Português</a> · <a href="README_ja.md">日本語</a> · <a href="README_ko.md">한국어</a> · <a href="README_ar.md">العربية</a>
</p>

---

**Stellara Work** est un agent de bureau **local-first** qui fonctionne comme un Codex personnel. Utilisez votre propre clé API compatible OpenAI (`base_url + api_key`) pour collaborer avec l'agent sur votre bureau — lecture de fichiers, édition de code, exécution de commandes — avec révision et approbation à chaque étape.

Les clés API, sessions, fichiers et configurations **ne quittent jamais votre appareil**. Stellara Work ne télécharge aucune données vers des serveurs externes.

---

## Fonctionnalités principales

| | Fonctionnalité | Description |
|---|---|---|
| 🔒 | **Confidentialité locale** | Les clés API sont chiffrées via le trousseau système (macOS) / DPAPI (Windows) ; toutes les données sont stockées localement |
| 🧠 | **Modèle propre** | Compatible avec tout point de terminaison du protocole OpenAI ; préréglages intégrés GLM, DeepSeek, Kimi, MiniMax ; support de modèles personnalisés illimités |
| ✅ | **Mode planification + contrôle d'approbation** | Chaque écriture de fichier et exécution de commande nécessitent votre approbation explicite |
| 💬 | **Dialogue en flux** | Rendu Markdown en temps réel, vue diff et cartes de sortie de commandes |
| 🗂️ | **Espace de travail projet** | Pointage vers n'importe quel dossier, l'agent lit, écrit et vérifie sur le code réel |
| 🧰 | **Compétences et MCP** | Extension des capacités de l'agent avec des compétences personnalisées et des serveurs MCP |
| 🧠 | **Centre de mémoire** | Mémoire persistante et consultable entre les sessions |
| 📎 | **Pièces jointes** | Glisser-déposer de fichiers et d'images dans n'importe quelle session |
| 📂 | **Gestionnaire de fichiers** | Arborescence latérale, création de fichiers/dossiers |
| 🎨 | **Système de design** | Variables de style UI unifiées et design du bureau de travail |

---

## Captures d'écran

| Accueil | Dialogue | Paramètres |
|:---:|:---:|:---:|
| ![Accueil](../../assets/screenshots/home.png) | ![Dialogue](../../assets/screenshots/chat.png) | ![Paramètres](../../assets/screenshots/settings.png) |

---

## Téléchargement

**Dernière version : v0.9.1**

| Plateforme | Package d'installation |
|---|---|
| macOS (Apple Silicon) | [Stellara Work-0.9.1-arm64.dmg](https://github.com/strashineltd/stellara-work/releases/latest) |
| Windows (x64) | [Stellara Work-Setup-0.9.1.exe](https://github.com/strashineltd/stellara-work/releases/latest) |

> **Remarque :** Les packages d'installation actuels ne sont pas signés. Sur macOS, faites un clic droit → Ouvrir ; sur Windows, sélectionnez "Informations complémentaires → Exécuter quand même" dans SmartScreen.

---

## Démarrage rapide

### Prérequis

- Node.js 20+
- Windows : Python 3.x + Visual Studio Build Tools (développement bureau C++) — requis uniquement pour le premier `npm install`
- macOS / Linux : aucune installation supplémentaire nécessaire

### 1. Installation des dépendances

```bash
npm install
```

Sur macOS/Linux, vous pouvez utiliser `bash setup.sh` (vérification de Node, installation des dépendances, exécution des tests).

### 2. Lancement

```bash
npm run dev
```

Au premier lancement, suivez les instructions pour sélectionner un modèle et saisir votre clé API. La clé est chiffrée et accessible uniquement au processus principal.

### 3. Scripts courants

```bash
npm run dev          # Mode développement (Vite HMR + Electron)
npm test             # Exécution des tests
npm run typecheck    # Vérification des types pour les deux processus
npm run package:mac  # Construction du dmg/zip macOS (macOS uniquement)
npm run package:win  # Construction de l'installateur NSIS Windows
```

---

## Préréglages de modèles intégrés

| Modèle | Fournisseur | base_url |
|---|---|---|
| GLM-5.2 | ZhiPu AI | `https://open.bigmodel.cn/api/paas/v4` |
| DeepSeek-v4-Pro | DeepSeek | `https://api.deepseek.com` |
| Kimi-K3 | Moonshot | `https://api.moonshot.cn` |
| MiniMax-M3 | MiniMax | `https://api.minimaxi.com/v1` |
| Personnalisé | Votre | Tout point de terminaison compatible OpenAI |

---

## Modèle de sécurité

- `nodeIntegration: false` — le processus de rendu ne peut pas utiliser `require('fs')`
- `contextIsolation: true` — le JS du processus de rendu est isolé du preload
- `sandbox: true` — le processus de rendu s'exécute dans un bac à sable
- Les URL externes sont limitées aux protocoles `http/https/mailto`
- Tous les gestionnaires IPC vérifient la source de l'expéditeur
- Toutes les opérations dangereuses (écriture de fichiers, exécution de commandes) nécessitent une approbation explicite

---

## Architecture

```
electron/                  # Processus principal Electron
├── main.ts                # Point d'entrée + IPC handlers
├── preload.ts             # API contextBridge
├── agent/                 # Boucle de l'agent, planification, outils (fs / shell / grep / git)
├── llm/                   # Client compatible OpenAI + flux SSE
├── memory/                # Stockage persistant de la mémoire
└── config/                # Stockage chiffré des clés (safeStorage)
src/                       # Processus de rendu React
├── components/            # Chat, cartes de plan, paramètres, guide, accueil
├── styles/                # Variables de design + CSS du bureau
└── lib/                   # Utilitaires du processus de rendu
shared/                    # Contrats IPC partagés entre les processus
```

Stack technologique : Electron · React 19 · TypeScript · Vite · better-sqlite3 · CodeMirror 6

---

## Documentation

- [Guide de migration macOS](../macos-migration.md)
- [Guide de contribution](../../CONTRIBUTING.md)
- [Journal des modifications](../../CHANGELOG.md)

---

## Licence

[MIT](../../LICENSE) © Stellara Work
