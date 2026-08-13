// src/index.js
// Cloudflare Worker: POST /  { "question": "..." }
//
// Routing logic:
//   - Pertanyaan pendek/umum/santai           -> Gemini Flash (cepat, gratis di free tier)
//   - Pertanyaan panjang/spesifik/profesional -> Claude Sonnet (presisi tinggi, berbayar)
//   - Kalau Claude gagal (limit/credit habis/error) -> fallback otomatis ke Gemini
//     supaya widget tidak error total di frontend.
//
// API key TIDAK PERNAH dikirim ke browser - disimpan sebagai Worker Secret
// (lihat README, bagian "Set secrets").

import { PROFILE_CONTEXT } from "./profile.js";

// GANTI/lengkapi sesuai domain yang benar-benar men-serve widget chat kamu.
// Boleh lebih dari satu kalau situs bisa diakses dari beberapa domain.
const ALLOWED_ORIGINS = [
  "https://abdullahfaqih.web.id",
  "https://kazu11.github.io",
];

// -------------------------------------------------------------------------
// 1. ROUTING: tentukan model mana yang dipakai
// -------------------------------------------------------------------------
function shouldUseHighPrecisionModel(question) {
  const q = question.trim();

  const precisionKeywords = [
    "pengalaman kerja", "proyek", "project", "tech stack", "teknologi",
    "arsitektur", "sertifikasi", "pendidikan", "tanggung jawab",
    "achievement", "pencapaian", "portofolio profesional", "case study",
    "kontribusi", "role", "jabatan", "gaji", "salary", "wawancara",
    "technical", "detail teknis", "implementasi", "studi kasus",
  ];

  const isLong = q.length > 120;
  const hasPrecisionKeyword = precisionKeywords.some((k) =>
    q.toLowerCase().includes(k)
  );

  return isLong || hasPrecisionKeyword;
}

// -------------------------------------------------------------------------
// 2. PEMANGGILAN GEMINI FLASH
// -------------------------------------------------------------------------
async function askGeminiFlash(question, env) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${env.GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: PROFILE_CONTEXT }] },
      contents: [{ role: "user", parts: [{ text: question }] }],
      generationConfig: { maxOutputTokens: 400 },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "(tidak ada jawaban)";
}

// -------------------------------------------------------------------------
// 3. PEMANGGILAN CLAUDE SONNET
// -------------------------------------------------------------------------
async function askClaudeSonnet(question, env) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      // Cek https://docs.claude.com/en/docs/about-claude/models/overview
      // untuk model ID terbaru sebelum deploy - ID model berubah seiring waktu.
      model: "claude-sonnet-5",
      max_tokens: 600,
      system: PROFILE_CONTEXT,
      messages: [{ role: "user", content: question }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data?.content?.[0]?.text ?? "(tidak ada jawaban)";
}

// -------------------------------------------------------------------------
// 4. JAWAB PERTANYAAN + FALLBACK
// -------------------------------------------------------------------------
async function answerQuestion(question, env) {
  const useHighPrecision = shouldUseHighPrecisionModel(question);

  if (!useHighPrecision) {
    // Jalur normal: langsung Gemini
    const answer = await askGeminiFlash(question, env);
    return { answer, modelUsed: "gemini-flash" };
  }

  // Jalur presisi tinggi: coba Claude dulu, kalau gagal (limit/credit/error) -> fallback ke Gemini
  try {
    const answer = await askClaudeSonnet(question, env);
    return { answer, modelUsed: "claude-sonnet-5" };
  } catch (err) {
    console.error("Claude gagal, fallback ke Gemini:", err);
    const answer = await askGeminiFlash(question, env);
    return { answer, modelUsed: "gemini-flash (fallback)" };
  }
}

// -------------------------------------------------------------------------
// 5. HANDLER UTAMA (Cloudflare Worker export default fetch)
// -------------------------------------------------------------------------
function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...headers },
      });
    }

    let question;
    try {
      const body = await request.json();
      question = body.question;
    } catch {
      question = null;
    }

    if (!question || typeof question !== "string" || !question.trim()) {
      return new Response(
        JSON.stringify({ error: "Field 'question' wajib diisi" }),
        { status: 400, headers: { "Content-Type": "application/json", ...headers } }
      );
    }

    try {
      const result = await answerQuestion(question, env);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json", ...headers },
      });
    } catch (err) {
      console.error(err);
      return new Response(
        JSON.stringify({ error: "Gagal mendapatkan jawaban dari AI." }),
        { status: 500, headers: { "Content-Type": "application/json", ...headers } }
      );
    }
  },
};