<p align="center">
  <img src="../../assets/icon-512.png" width="120" alt="Stellara Work" />
</p>

<h1 align="center">Stellara Work</h1>

<p align="center">
  <strong>وكيل سطح مكتب بأسلوب Codex يعمل محلياً بشكل أساسي</strong>، يدعم Windows وmacOS.<br/>
  يأتي بمفتاح API متوافق مع OpenAI — جميع البيانات تبقى على الجهاز المحلي فقط.
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README_zh-CN.md">简体中文</a> · <a href="README_zh-TW.md">繁體中文</a> · <a href="README_ru.md">Русский</a> · <a href="README_fr.md">Français</a> · <a href="README_de.md">Deutsch</a> · <a href="README_es.md">Español</a> · <a href="README_pt-BR.md">Português</a> · <a href="README_ja.md">日本語</a> · <a href="README_ko.md">한국어</a>
</p>

---

**Stellara Work** هو وكيل سطح مكتب **يعمل محلياً بشكل أساسي**، يعمل بطريقة مشابهة لـ Codex الشخصي. يحتوي على مفتاح API متوافق مع OpenAI (`base_url + api_key`)، ويتعاون مع الوكيل على منصة سطح المكتب لإكمال مهام البرمجة — قراءة الملفات، تعديل الأوامر، تنفيذ الأوامر — مع إمكانية المراجعة والموافقة في كل مرحلة.

مفتاح API والجلسات والملفات والتكوينات **لا تغادر الجهاز المحلي أبداً**. لا يقوم Stellara Work بتحميل أي بيانات إلى خوادم خارجية.

---

## الميزات الرئيسية

| | الميزة | الوصف |
|---|---|---|
| 🔒 | **الخصوصية المحلية أولاً** | يتم تشفير مفتاح API بواسطة مفتاح النظام (macOS) / DPAPI (Windows)؛ جميع البيانات مخزنة محلياً |
| 🧠 | **النماذج المدمجة** | متوافق مع أي نقطة نهاية بروتوكول OpenAI؛ يحتوي على إعدادات مسبقة لـ GLM وDeepSeek وKimi وMiniMax؛ يدعم نماذج مخصصة غير محدودة |
| ✅ | **وضع الخطة + بوابة الموافقة** | كل كتابة ملف أو تنفيذ أمر يتطلب موافقتك الصريحة |
| 💬 | **المحادثة المتدفقة** | عرض Markdown في الوقت الفعلي، عرض الاختلافات وبطاقات مخرجات الأوامر |
| 🗂️ | **مساحة العمل للمشروع** | حدد أي مجلد، يعمل الوكيل على قراءة وكتابة والتحقق من الكود الفعلي |
| 🧰 | **المهارات و MCP** | قم بتوسيع قدرات الوكيل باستخدام المهارات المخصصة وخوادم MCP |
| 🧠 | **مركز الذاكرة** | ذاكرة مستمرة وقابلة للبحث عبر الجلسات |
| 📎 | **المرفقات** | اسحب وأفلت الملفات والصور في أي جلسة |
| 📂 | **مدير الملفات** | شجرة ملفات في الشريط الجانبي، تدعم إنشاء ملفات/مجلدات جديدة |
| 🎨 | **نظام التصميم** | متغيرات نمط UI موحدة وتصميم منصة العمل |

---

## لقطات الشاشة

| الرئيسية | المحادثة | الإعدادات |
|:---:|:---:|:---:|
| ![الرئيسية](../../assets/screenshots/home.png) | ![المحادثة](../../assets/screenshots/chat.png) | ![الإعدادات](../../assets/screenshots/settings.png) |

---

## التحميل

**أحدث إصدار: v0.9.1**

| المنصة | حزمة التثبيت |
|---|---|
| macOS (Apple Silicon) | [Stellara Work-0.9.1-arm64.dmg](https://github.com/strashineltd/stellara-work/releases/latest) |
| Windows (x64) | [Stellara Work-Setup-0.9.1.exe](https://github.com/strashineltd/stellara-work/releases/latest) |

> **ملاحظة:** حزم التثبيت الحالية غير موقعة. على macOS، انقر بزر الماوس الأيمن → افتح؛ على Windows، اختر "مزيد من المعلومات → تشغيل على أي حال" في SmartScreen.

---

## البدء السريع

### المتطلبات

- Node.js 20+
- Windows: Python 3.x + أدوات بناء Visual Studio (تطوير سطح المكتب C++) — مطلوب فقط في المرة الأولى عند `npm install`
- macOS / Linux: لا حاجة لتثبيت إضافي

### 1. تثبيت التبعيات

```bash
npm install
```

على macOS/Linux يمكن استخدام `bash setup.sh` (فحص Node، تثبيت التبعيات، تشغيل الاختبارات).

### 2. التشغيل

```bash
npm run dev
```

عند التشغيل لأول مرة، اتبع الدليل لاختيار النموذج وإدخال مفتاح API. يتم تخزين المفتاح بشكل مشفر ولا يمكن قراءته إلا من العملية الرئيسية.

### 3. الأوامر الشائعة

```bash
npm run dev          # وضع التطوير (Vite HMR + Electron)
npm test             # تشغيل الاختبارات
npm run typecheck    # فحص نوع العمليتين
npm run package:mac  # بناء dmg/zip لـ macOS (macOS فقط)
npm run package:win  # بناء حزمة تثبيت NSIS لـ Windows
```

---

## الإعدادات المسبقة للنماذج المدمجة

| النموذج | المزود | base_url |
|---|---|---|
| GLM-5.2 | 智谱大模型 | `https://open.bigmodel.cn/api/paas/v4` |
| DeepSeek-v4-Pro | DeepSeek | `https://api.deepseek.com` |
| Kimi-K3 | Moonshot | `https://api.moonshot.cn` |
| MiniMax-M3 | MiniMax | `https://api.minimaxi.com/v1` |
| مخصص | الخاص بك | أي نقطة نهاية متوافقة مع OpenAI |

---

## نموذج الأمان

- `nodeIntegration: false` — عملية العرض لا تستطيع `require('fs')`
- `contextIsolation: true` — عملية العرض JS معزولة عن preload
- `sandbox: true` — عملية العرض تعمل في صندوق رملي
- الروابط الخارجية محدودة ببروتوكولات `http/https/mailto`
- جميع معالجات IPC تتحقق من مصدر المرسل
- جميع العمليات الخطيرة (كتابة الملفات، تنفيذ الأوامر) تتطلب موافقة صريحة

---

## الهندسة المعمارية

```
electron/                  # Electron العملية الرئيسية
├── main.ts                # نقطة الدخول + معالجات IPC
├── preload.ts             # contextBridge API
├── agent/                 # حلقة الوكيل، التخطيط، الأدوات (fs / shell / grep / git)
├── llm/                   # عميل متوافق مع OpenAI + تدفق SSE
├── memory/                # تخزين الذاكرة المستمرة
└── config/                # تخزين المفاتيح المشفرة (safeStorage)
src/                       # React عملية العرض
├── components/            # المحادثة، بطاقات الخطة، الإعدادات، الدليل، الرئيسية
├── styles/                # متغيرات التصميم + CSS منصة العمل
└── lib/                   # أدوات عملية العرض
shared/                    # عقد IPC مشتركة بين العمليتين
```

ال_stack التقني: Electron · React 19 · TypeScript · Vite · better-sqlite3 · CodeMirror 6

---

## الوثائق

- [دليل ترحيل macOS](../macos-migration.md)
- [دليل المساهمة](../../CONTRIBUTING.md)
- [سجل التغييرات](../../CHANGELOG.md)

---

## الترخيص

[MIT](../../LICENSE) © Stellara Work
