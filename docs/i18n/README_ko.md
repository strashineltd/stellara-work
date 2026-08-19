<p align="center">
  <img src="../../assets/icon-512.png" width="120" alt="Stellara Work" />
</p>

<h1 align="center">Stellara Work</h1>

<p align="center">
  <strong>로컬 우선 Codex 스타일 데스크톱 에이전트</strong>로, Windows와 macOS를 지원합니다.<br/>
  OpenAI 호환 API 키를 자체 제공하며, 모든 데이터는 로컬에만 저장됩니다.
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README_zh-CN.md">简体中文</a> · <a href="README_ru.md">Русский</a> · <a href="README_fr.md">Français</a> · <a href="README_de.md">Deutsch</a> · <a href="README_es.md">Español</a> · <a href="README_pt-BR.md">Português</a> · <a href="README_ja.md">日本語</a> · <a href="README_ar.md">العربية</a>
</p>

---

**Stellara Work**는 개인 Codex와 유사한 방식으로 작동하는 **로컬 우선** 데스크톱 에이전트입니다. OpenAI 호환 API 키(`base_url + api_key`)를 자체적으로 갖추고 있으며, 데스크톱 워크벤치에서 에이전트와 협업하여 코딩 작업을 수행합니다—파일 읽기, 코드 편집, 명령 실행—모든 과정에서 검토 및 승인이 가능합니다.

API 키, 세션, 파일 및 설정은 **절대로 로컬을 벗어나지 않습니다**. Stellara Work는 외부 서버로 어떠한 데이터도 업로드하지 않습니다.

---

## 주요 기능

| | 기능 | 설명 |
|---|---|---|
| 🔒 | **로컬 프라이버시 우선** | API 키는 시스템 키체인(macOS) / DPAPI(Windows)로 암호화되며, 모든 데이터는 로컬에 저장됩니다 |
| 🧠 | **자체 모델** | 모든 OpenAI 프로토콜 엔드포인트와 호환되며, GLM, DeepSeek, Kimi, MiniMax 프리셋이 내장되어 있고 무제한 사용자 정의 모델을 지원합니다 |
| ✅ | **계획 모드 + 승인 게이트** | 모든 파일 쓰기, 명령 실행 시 명시적 승인이 필요합니다 |
| 💬 | **스트리밍 대화** | 실시간 Markdown 렌더링, diff 보기 및 명령 출력 카드 |
| 🗂️ | **프로젝트 워크스페이스** | 원하는 폴더를 지정하면 에이전트가 실제 코드에서 읽기, 쓰기 및 검증을 수행합니다 |
| 🧰 | **스킬 및 MCP** | 사용자 정의 스킬과 MCP 서버로 에이전트 기능을 확장합니다 |
| 🧠 | **메모리 센터** | 세션 간 지속 가능하고 검색 가능한 메모리 |
| 📎 | **첨부 파일** | 모든 세션에서 파일 및 이미지를 드래그 앤 드롭할 수 있습니다 |
| 📂 | **파일 관리자** | 사이드바 파일 트리, 새 파일/폴더 생성 지원 |
| 🎨 | **디자인 시스템** | 통합된 UI 스타일 변수 및 워크벤치 디자인 |

---

## 스크린샷

| 홈 | 대화 | 설정 |
|:---:|:---:|:---:|
| ![홈](../../assets/screenshots/home.png) | ![대화](../../assets/screenshots/chat.png) | ![설정](../../assets/screenshots/settings.png) |

---

## 다운로드

**최신 버전: v0.9.1**

| 플랫폼 | 설치 패키지 |
|---|---|
| macOS (Apple Silicon) | [Stellara Work-0.9.1-arm64.dmg](https://github.com/strashineltd/stellara-work/releases/latest) |
| Windows (x64) | [Stellara Work-Setup-0.9.1.exe](https://github.com/strashineltd/stellara-work/releases/latest) |

> **참고:** 현재 설치 패키지에 서명이 되어 있지 않습니다. macOS에서는 마우스 오른쪽 버튼 클릭 → 열기를 선택하고, Windows에서는 SmartScreen에서 "추가 정보 → 그래도 실행"을 선택하세요.

---

## 빠른 시작

### 필수 요구 사항

- Node.js 20+
- Windows: Python 3.x + Visual Studio Build Tools(데스크톱 개발 C++) — 최초 `npm install` 시에만 필요
- macOS / Linux: 추가 설치 불필요

### 1. 의존성 설치

```bash
npm install
```

macOS/Linux에서는 `bash setup.sh`를 사용할 수 있습니다(Node 확인, 의존성 설치, 테스트 실행).

### 2. 시작

```bash
npm run dev
```

최초 시작 시 가이드에 따라 모델을 선택하고 API 키를 입력하세요. 키는 암호화되어 저장되며, 메인 프로세스만 읽을 수 있습니다.

### 3. 자주 사용하는 스크립트

```bash
npm run dev          # 개발 모드 (Vite HMR + Electron)
npm test             # 테스트 실행
npm run typecheck    # 두 프로세스 타입 검사
npm run package:mac  # macOS dmg/zip 빌드 (macOS 전용)
npm run package:win  # Windows NSIS 설치 패키지 빌드
```

---

## 내장 모델 프리셋

| 모델 | 제공자 | base_url |
|---|---|---|
| GLM-5.2 | 智谱大模型 | `https://open.bigmodel.cn/api/paas/v4` |
| DeepSeek-v4-Pro | DeepSeek | `https://api.deepseek.com` |
| Kimi-K3 | Moonshot | `https://api.moonshot.cn` |
| MiniMax-M3 | MiniMax | `https://api.minimaxi.com/v1` |
| 사용자 정의 | 사용자 | 모든 OpenAI 호환 엔드포인트 |

---

## 보안 모델

- `nodeIntegration: false` — 렌더러 프로세스가 `require('fs')`를 호출할 수 없습니다
- `contextIsolation: true` — 렌더러 프로세스의 JS와 preload가 격리됩니다
- `sandbox: true` — 렌더러 프로세스가 샌드박스에서 실행됩니다
- 외부 URL은 `http/https/mailto` 프로토콜로 제한됩니다
- 모든 IPC 핸들러가 발신자 출처를 검증합니다
- 모든 위험한 작업(파일 쓰기, 명령 실행)은 명시적 승인이 필요합니다

---

## 아키텍처

```
electron/                  # Electron 메인 프로세스
├── main.ts                # 진입점 + IPC 핸들러
├── preload.ts             # contextBridge API
├── agent/                 # 에이전트 루프, 계획, 도구 (fs / shell / grep / git)
├── llm/                   # OpenAI 호환 클라이언트 + SSE 스트리밍
├── memory/                # 지속적 메모리 저장소
└── config/                # 암호화 키 저장 (safeStorage)
src/                       # React 렌더러 프로세스
├── components/            # 채팅, 계획 카드, 설정, 가이드, 홈
├── styles/                # 디자인 변수 + 워크벤치 CSS
└── lib/                   # 렌더러 유틸리티
shared/                    # 양방향 프로세스 간 공유 IPC 계약
```

기술 스택: Electron · React 19 · TypeScript · Vite · better-sqlite3 · CodeMirror 6

---

## 문서

- [macOS 마이그레이션 가이드](../macos-migration.md)
- [기여 가이드](../../CONTRIBUTING.md)
- [변경 내역](../../CHANGELOG.md)

---

## 라이선스

[MIT](../../LICENSE) © Stellara Work
