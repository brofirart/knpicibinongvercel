// api/preview.js
// -----------------------------------------------------------------------
// Endpoint ini dipakai sebagai "link yang dibagikan" (dipanggil dari
// buildShareUrl() di index.html) untuk berita & kegiatan, contoh:
//   https://situsanda.com/api/preview?type=berita&id=n1
//
// Kenapa perlu file terpisah seperti ini?
// Situs utama (index.html) adalah SPA: satu file HTML yang sama untuk
// SEMUA halaman, isinya baru terisi belakangan lewat JavaScript. Bot
// WhatsApp/Telegram/Facebook/Twitter dkk yang membuat "preview" saat
// link ditempel TIDAK menjalankan JavaScript sama sekali — mereka
// hanya membaca tag <meta property="og:..."> yang ada di HTML mentah.
// Karena itu, thumbnail per-berita yang beda-beda TIDAK BISA dibuat
// hanya dengan mengedit index.html; perlu "pintu" server kecil seperti
// ini yang membalas HTML berbeda sesuai id berita yang diminta.
//
// Cara kerja:
// 1. Kalau yang mengakses adalah bot media sosial -> balas halaman
//    HTML kecil berisi og:title, og:description, og:image sesuai
//    berita/kegiatan tsb (gambarnya diambil dari api/preview-image.js).
// 2. Kalau yang mengakses adalah pengunjung biasa (browser manusia)
//    -> langsung dialihkan (redirect) ke halaman situs yang
//    sesungguhnya, supaya pengalamannya tetap normal seperti biasa.
//
// CARA PASANG (sekali saja):
// 1. Simpan file ini di:            api/preview.js
// 2. Simpan file satunya lagi di:   api/preview-image.js
//    (di root project yang sama dengan index.html, folder "api" sejajar
//     dengan index.html — bukan di dalam folder lain)
// 3. Deploy ulang / push ke Vercel seperti biasa. Vercel otomatis
//    mengenali isi folder api/ sebagai Serverless Function, tidak perlu
//    konfigurasi tambahan.
// 4. Selesai — tombol "Bagikan" di situs otomatis memakai endpoint ini.
// -----------------------------------------------------------------------

const FIREBASE_PROJECT_ID = 'pkknpicibinong';
const FIREBASE_API_KEY = 'AIzaSyDwRGLg8qo3ns8_RSQLMrXe3oG7r0w1--s';
const FB_COLLECTION = 'knpicibinong';

const BOT_UA = /(facebookexternalhit|Facebot|WhatsApp|TelegramBot|Twitterbot|LinkedInBot|Discordbot|Slackbot|SkypeUriPreview|Pinterest|vkShare|redditbot|Googlebot|Applebot|Google-InspectionTool|W3C_Validator|Embedly|Iframely|Bitrix|Line\/|NaverBot)/i;

function getQuery(req){
  if(req.query && Object.keys(req.query).length) return req.query;
  try{ return Object.fromEntries(new URL(req.url, 'http://localhost').searchParams); }
  catch(e){ return {}; }
}

function escapeHtml(s){
  return String(s || '').replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

async function fetchRawFields(key){
  const url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID +
    '/databases/(default)/documents/' + FB_COLLECTION + '/' + encodeURIComponent(key) +
    '?key=' + FIREBASE_API_KEY;
  const res = await fetch(url);
  if(!res.ok) return null;
  const json = await res.json();
  return json.fields || null;
}
function fStr(fields, name){ return fields && fields[name] ? fields[name].stringValue : undefined; }
function fBool(fields, name){ return !!(fields && fields[name] && fields[name].booleanValue); }
function fInt(fields, name){
  if(!fields || !fields[name]) return 0;
  return parseInt(fields[name].integerValue || fields[name].doubleValue || '0', 10);
}
async function getStoredValue(key){
  const fields = await fetchRawFields(key);
  if(!fields) return null;
  if(fBool(fields, 'chunked')){
    const count = fInt(fields, 'count');
    const parts = await Promise.all(
      Array.from({length: count}, function(_, i){ return fetchRawFields(key + '__chunk_' + i); })
    );
    return parts.map(function(p){ return fStr(p, 'part') || ''; }).join('');
  }
  const v = fStr(fields, 'value');
  return v === undefined ? null : v;
}

module.exports = async (req, res) => {
  try{
    const q = getQuery(req);
    const type = q.type === 'kegiatan' ? 'kegiatan' : 'berita';
    const id = q.id || '';

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const siteUrl = proto + '://' + host;
    const pageUrl = siteUrl + '/?' + type + '=' + encodeURIComponent(id);

    if(!id){ res.writeHead(302, { Location: siteUrl }); res.end(); return; }

    const ua = req.headers['user-agent'] || '';
    const isBot = BOT_UA.test(ua);

    let item = null;
    try{
      const raw = await getStoredValue(type === 'berita' ? 'news-data' : 'activity-data');
      const list = raw ? JSON.parse(raw) : [];
      item = list.find(function(x){ return x.id === id; }) || null;
    }catch(e){ console.error('preview: gagal ambil data', e); }

    if(!item || !isBot){
      res.writeHead(302, { Location: pageUrl });
      res.end();
      return;
    }

    const title = item.title || 'PK KNPI Cibinong';
    const desc = String(item.excerpt || item.desc || '').slice(0, 200);
    const imgUrl = siteUrl + '/api/preview-image?type=' + type + '&id=' + encodeURIComponent(id);

    const html = '<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">' +
      '<title>' + escapeHtml(title) + '</title>' +
      '<meta property="og:type" content="article">' +
      '<meta property="og:site_name" content="PK KNPI Cibinong">' +
      '<meta property="og:title" content="' + escapeHtml(title) + '">' +
      '<meta property="og:description" content="' + escapeHtml(desc) + '">' +
      '<meta property="og:image" content="' + imgUrl + '">' +
      '<meta property="og:image:width" content="1200">' +
      '<meta property="og:image:height" content="630">' +
      '<meta property="og:url" content="' + pageUrl + '">' +
      '<meta name="twitter:card" content="summary_large_image">' +
      '<meta name="twitter:title" content="' + escapeHtml(title) + '">' +
      '<meta name="twitter:description" content="' + escapeHtml(desc) + '">' +
      '<meta name="twitter:image" content="' + imgUrl + '">' +
      '<meta http-equiv="refresh" content="0; url=' + pageUrl + '">' +
      '</head><body>Mengalihkan ke <a href="' + pageUrl + '">' + escapeHtml(title) + '</a>&hellip;</body></html>';

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.end(html);
  }catch(e){
    console.error('preview error', e);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Terjadi kesalahan');
  }
};
