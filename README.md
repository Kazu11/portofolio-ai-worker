# AI Chat Portofolio — GitHub Pages + Cloudflare Workers

## Arsitektur
```
GitHub Pages (index.html, static)  --fetch-->  Cloudflare Worker  --api-->  Gemini Flash / Claude Sonnet
```
- **GitHub Pages**: hosting file statis kamu (`index.html`, `assets/`) — tidak berubah, tetap gratis.
- **Cloudflare Worker**: "backend" ringan yang menyimpan API key dengan aman dan
  melakukan routing antara Gemini Flash dan Claude Sonnet.

## Cara kerja
1. Pengunjung ketik pertanyaan di widget chat (`frontend-snippet.html`, sudah ditempel di `index.html`).
2. Browser kirim `POST` ke URL Worker kamu.
3. Worker (`src/index.js`):
   - Menentukan pertanyaan "singkat/santai" vs "presisi tinggi/profesional" lewat
     `shouldUseHighPrecisionModel()`.
   - Menyisipkan `PROFILE_CONTEXT` (dari `src/profile.js`) sebagai *system prompt*,
     supaya jawaban selalu akurat tentang kamu.
   - Memanggil Gemini Flash **atau** Claude Sonnet, lalu kirim balik jawabannya.

## Kenapa bukan "fine-tuning" / training model?
Untuk use case "AI yang tahu tentang saya", fine-tuning itu overkill: butuh banyak
data berkualitas, dan model publik (Gemini/Claude API) tidak dirancang untuk
di-fine-tune dengan mudah untuk data personal semacam ini.

Solusi di sini disebut **context injection** (bentuk sederhana dari RAG): setiap
request selalu disertai data diri kamu di `src/profile.js` sebagai instruksi sistem.
Model "belajar" tentang kamu bukan lewat training ulang bobotnya, tapi lewat info
yang selalu disisipkan real-time — murah, instan diupdate (tinggal edit file &
redeploy), dan hasilnya konsisten.

> Kalau nanti datanya sangat besar (puluhan halaman CV/blog), baru worth it pakai
> RAG dengan vector database (misalnya **Cloudflare Vectorize**, yang juga native
> di ekosistem Cloudflare) supaya tidak semua data dikirim tiap request. Untuk
> portofolio personal, context injection ini sudah lebih dari cukup.

## Setup

### 1. Install Wrangler (CLI Cloudflare)
```bash
npm install -g wrangler
wrangler login
```

### 2. Isi data diri
Edit `src/profile.js`, lengkapi semua bagian `[isi ...]`.

### 3. Ganti domain di src/index.js
```js
const ALLOWED_ORIGIN = "https://kazu11.github.io"; // ganti sesuai domain GitHub Pages kamu
```
Ini membatasi siapa saja yang boleh memanggil Worker kamu (mencegah orang lain
"numpang" pakai API key kamu dari domain lain).

### 4. Ambil API key
- Gemini: https://aistudio.google.com/apikey
- Claude (Anthropic): https://console.anthropic.com/settings/keys

### 5. Set secrets di Cloudflare (JANGAN taruh di kode / commit ke git)
```bash
wrangler secret put GEMINI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
```
(Wrangler akan minta kamu paste value-nya, tersimpan aman di Cloudflare — bukan di repo.)

### 6. Deploy Worker
```bash
wrangler deploy
```
Setelah sukses, kamu akan dapat URL seperti:
```
https://portfolio-ai-chat.<subdomain-kamu>.workers.dev
```

### 7. Sambungkan ke frontend
- Tempel isi `frontend-snippet.html` ke `index.html` (sebelum `</body>`).
- Ganti `WORKER_URL` di snippet itu dengan URL Worker kamu dari langkah 6.
- Commit & push — GitHub Pages otomatis redeploy.

### 8. Test lokal (opsional)
```bash
wrangler dev
```
Buka `http://localhost:8787`, test dengan curl:
```bash
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d '{"question":"Apa pengalaman kerja Abdullah?"}'
```

## Struktur folder
```
portfolio-ai-cf/
├── wrangler.toml
├── src/
│   ├── index.js      <- Worker utama (routing + panggil API)
│   └── profile.js     <- Data diri kamu
└── frontend-snippet.html  <- tempel isinya ke index.html repo portofolio
```
Kamu bisa taruh folder Worker ini di **repo terpisah**, atau digabung di repo
`portofolio` yang sama (asalkan GitHub Pages tetap hanya men-serve `index.html`/`assets`,
bukan folder `src`).

## Catatan keamanan
- API key HANYA ada di Cloudflare Secrets, tidak pernah di kode/browser.
- `ALLOWED_ORIGIN` membatasi domain yang boleh memanggil Worker — set ke domain
  GitHub Pages kamu, bukan `*`.
- Cloudflare Workers punya rate limiting built-in di level akun; untuk proteksi
  tambahan bisa pakai **Cloudflare Turnstile** (captcha invisible) di widget chat
  supaya bot tidak menghabiskan kuota API key kamu.

## Model yang dipakai
- Gemini: `gemini-flash-latest` — cek model terbaru di
  https://ai.google.dev/gemini-api/docs/models
- Claude: `claude-sonnet-5` — cek model ID terbaru sebelum deploy production di
  https://docs.claude.com/en/docs/about-claude/models/overview
