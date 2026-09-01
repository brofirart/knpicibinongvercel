/* ================================================================
   middleware.js — Vercel Edge Middleware
   ----------------------------------------------------------------
   Tugasnya: waktu link berita/kegiatan situs ini ditempel di
   WhatsApp/Facebook/Telegram/dll, aplikasi medsos tsb akan mengirim
   "robot" (bukan browser manusia) untuk mengambil halaman dan
   membaca tag <meta property="og:..."> di dalamnya — TANPA
   menjalankan JavaScript sama sekali.

   Karena situs ini adalah single-page app yang me-render semua
   konten lewat JavaScript, robot itu tidak akan pernah melihat judul
   & gambar berita yang sebenarnya kalau tidak dibantu. Middleware
   ini yang membantu: kalau permintaan datang dari robot medsos DAN
   ada parameter ?berita=ID atau ?kegiatan=ID di URL, middleware akan
   mengambil data berita/kegiatan itu dari Firestore, lalu membalas
   dengan halaman HTML kecil berisi tag og:title / og:description /
   og:image yang sesuai. Untuk pengunjung biasa (bukan robot),
   permintaan diteruskan apa adanya ke index.html seperti biasa.

   TIDAK PERLU install package apapun — hanya pakai fetch() bawaan.
   Taruh file ini di ROOT project (sejajar dengan index.html).
   ================================================================ */

export const config = {
  // Middleware ini hanya perlu jalan di halaman utama, karena semua
  // link berita/kegiatan situs ini mengarah ke sini dengan query string.
  matcher: ['/', '/index.html'],
};

// Samakan dengan FIREBASE_CONFIG & _FB_COLLECTION di index.html
const FIRESTORE_PROJECT_ID = 'pkknpicibinong';
const FIRESTORE_COLLECTION = 'knpicibinong';

// Daftar User-Agent "robot" pengambil preview link dari berbagai platform.
const BOT_RE = /facebookexternalhit|Facebot|WhatsApp|Twitterbot|TelegramBot|LinkedInBot|Slackbot|Discordbot|redditbot|Pinterest|vkShare|SkypeUriPreview|Applebot|Google-InspectionTool|Googlebot|W3C_Validator|Iframely|Embedly|LinkPreview|line-poker/i;

export default async function middleware(request) {
  const ua = request.headers.get('user-agent') || '';

  // Bukan robot medsos -> jangan ganggu, biarkan index.html asli terkirim.
  if (!BOT_RE.test(ua)) return;

  const url = new URL(request.url);
  const beritaId = url.searchParams.get('berita');
  const kegiatanId = url.searchParams.get('kegiatan');
  const pageUrl = url.origin + url.pathname + url.search;

  let title, desc, imageUrl;

  try {
    if (beritaId) {
      const n = await findItem('news-data', beritaId);
      if (!n) return; // berita tidak ditemukan -> biarkan default saja
      title = n.title || 'Berita';
      desc = stripHtml(n.excerpt || n.content || '').slice(0, 200);
      imageUrl = `${url.origin}/api/og-image?type=berita&id=${encodeURIComponent(beritaId)}`;
    } else if (kegiatanId) {
      const a = await findItem('activity-data', kegiatanId);
      if (!a) return;
      title = a.title || 'Kegiatan';
      desc = stripHtml(a.desc || a.description || '').slice(0, 200) || `Kegiatan ${a.title || ''}`;
      imageUrl = `${url.origin}/api/og-image?type=kegiatan&id=${encodeURIComponent(kegiatanId)}`;
    } else {
      // Share halaman utama (tanpa ID tertentu) -> pakai identitas situs.
      const cfg = await getJsonValue('site-config');
      title = (cfg && cfg.orgName) || 'PK KNPI Cibinong';
      desc = (cfg && (cfg.tagline || cfg.heroSubtitle)) || '';
      imageUrl = cfg && cfg.logo ? `${url.origin}/api/og-image?type=logo` : null;
    }
  } catch (e) {
    return; // ada error -> aman-nya biarkan index.html asli yang jalan
  }

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${imageUrl ? `<meta property="og:image" content="${esc(imageUrl)}">
<meta property="og:image:secure_url" content="${esc(imageUrl)}">` : ''}
<meta property="og:url" content="${esc(pageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
${imageUrl ? `<meta name="twitter:image" content="${esc(imageUrl)}">` : ''}
<meta http-equiv="refresh" content="0; url=${esc(pageUrl)}">
</head>
<body></body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}

/* ---------------- helper: baca data dari Firestore lewat REST API ---------------- */

async function getDoc(docId) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/${FIRESTORE_COLLECTION}/${encodeURIComponent(docId)}`
  );
  if (!res.ok) return null;
  const json = await res.json();
  return parseFields(json.fields);
}

function parseFields(fields) {
  const out = {};
  if (!fields) return out;
  for (const k in fields) {
    const v = fields[k];
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('booleanValue' in v) out[k] = v.booleanValue;
    else if ('integerValue' in v) out[k] = parseInt(v.integerValue, 10);
    else if ('doubleValue' in v) out[k] = v.doubleValue;
    else out[k] = null;
  }
  return out;
}

// Meniru window.storage.get(key) di index.html, termasuk penggabungan
// dokumen yang di-"chunk" kalau datanya besar.
async function getRawValue(key) {
  const doc = await getDoc(key);
  if (!doc) return null;
  if (doc.chunked) {
    const count = doc.count || 0;
    let value = '';
    for (let i = 0; i < count; i++) {
      const part = await getDoc(key + '__chunk_' + i);
      value += (part && part.part) || '';
    }
    return value;
  }
  if (doc.value === undefined || doc.value === null) return null;
  return doc.value;
}

async function getJsonValue(key) {
  const raw = await getRawValue(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

async function findItem(storageKey, id) {
  const list = await getJsonValue(storageKey);
  if (!Array.isArray(list)) return null;
  return list.find((it) => String(it.id) === String(id)) || null;
}

function stripHtml(s) {
  return String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
