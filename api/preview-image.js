// api/preview-image.js
// -----------------------------------------------------------------------
// Menyediakan gambar berita/kegiatan sebagai URL asli yang bisa diambil
// (fetch) oleh crawler WhatsApp/Telegram/Facebook dkk. Ini perlu karena
// di database, foto disimpan sebagai teks base64 (data:image/jpeg;
// base64,...) — dan hampir semua platform TIDAK mau menampilkan
// og:image berupa teks base64, mereka wajib men-download gambar dari
// sebuah URL. File ini yang menjembatani: baca base64 dari Firestore,
// lalu kirim balik sebagai file gambar sungguhan.
//
// Dipanggil otomatis oleh api/preview.js — tidak perlu diutak-atik
// manual. Simpan berdampingan dengan api/preview.js di folder api/.
// -----------------------------------------------------------------------

const FIREBASE_PROJECT_ID = 'pkknpicibinong';
const FIREBASE_API_KEY = 'AIzaSyDwRGLg8qo3ns8_RSQLMrXe3oG7r0w1--s';
const FB_COLLECTION = 'knpicibinong';

function getQuery(req){
  if(req.query && Object.keys(req.query).length) return req.query;
  try{ return Object.fromEntries(new URL(req.url, 'http://localhost').searchParams); }
  catch(e){ return {}; }
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
    if(!id){ res.writeHead(400); res.end('Missing id'); return; }

    const raw = await getStoredValue(type === 'berita' ? 'news-data' : 'activity-data');
    const list = raw ? JSON.parse(raw) : [];
    const item = list.find(function(x){ return x.id === id; });
    const dataUri = item ? (type === 'berita' ? item.image : item.cover) : null;

    if(!dataUri){ res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Gambar tidak ditemukan'); return; }

    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUri);
    if(!m){ res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Format gambar tidak didukung'); return; }

    const mime = m[1];
    const buf = Buffer.from(m[2], 'base64');
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' });
    res.end(buf);
  }catch(e){
    console.error('preview-image error', e);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Terjadi kesalahan');
  }
};
