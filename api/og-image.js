/* ================================================================
   api/og-image.js — Vercel Serverless Function
   ----------------------------------------------------------------
   Kenapa file ini perlu ada:
   Foto berita/kegiatan di situs ini disimpan sebagai teks base64
   (contoh: "data:image/jpeg;base64,AAAA...") langsung di Firestore,
   BUKAN sebagai file gambar dengan URL sendiri. Padahal, tag
   <meta property="og:image"> yang dibaca WhatsApp/Facebook/Telegram
   WAJIB berisi URL gambar yang bisa mereka unduh sendiri — teks
   base64 tidak akan mereka anggap sebagai gambar.

   Fungsi ini menjembatani itu: dipanggil seperti
     /api/og-image?type=berita&id=XXXX
   lalu ia mengambil data base64 berita tsb dari Firestore, mengubahnya
   kembali jadi file gambar biner, dan mengirimkannya sebagai response
   gambar sungguhan (Content-Type: image/jpeg dst) — sehingga URL ini
   valid dipakai sebagai og:image.

   Taruh file ini di folder /api (otomatis dikenali Vercel sebagai
   serverless function, tidak perlu konfigurasi tambahan).
   ================================================================ */

// Samakan dengan FIREBASE_CONFIG & _FB_COLLECTION di index.html
const FIRESTORE_PROJECT_ID = 'pkknpicibinong';
const FIRESTORE_COLLECTION = 'knpicibinong';

module.exports = async (req, res) => {
  try {
    const { type, id } = req.query;
    let dataUrl = null;

    if (type === 'berita' && id) {
      const item = await findItem('news-data', id);
      dataUrl = item && item.image;
    } else if (type === 'kegiatan' && id) {
      const item = await findItem('activity-data', id);
      dataUrl = item && (item.cover || (item.photos && item.photos[0]));
    } else if (type === 'logo') {
      const cfg = await getJsonValue('site-config');
      dataUrl = cfg && cfg.logo;
    }

    if (!dataUrl) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Gambar tidak ditemukan');
      return;
    }

    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      res.statusCode = 404;
      res.end('Format gambar tidak dikenali');
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', parsed.mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(parsed.buffer);
  } catch (e) {
    res.statusCode = 500;
    res.end('Gagal mengambil gambar');
  }
};

/* ---------------- helper: sama seperti di middleware.js ---------------- */

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

// Mengubah "data:<mime>;base64,<data>" ATAU "data:<mime>,<data-uri-encoded>"
// (dua-duanya dipakai situs ini: foto upload = base64, placeholder = SVG uri-encoded)
// menjadi { mime, buffer } siap dikirim sebagai response gambar.
function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+)(;[^,]+)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const meta = match[2] || '';
  const data = match[3];
  if (meta.includes('base64')) {
    return { mime, buffer: Buffer.from(data, 'base64') };
  }
  return { mime, buffer: Buffer.from(decodeURIComponent(data), 'utf8') };
}
