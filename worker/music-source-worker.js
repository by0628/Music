// 雾中来信 · 音源中转 Worker
// 按「Hello World」音源(v260925)的明文接口规则取链：
//   网易云: c.wwwweb.top/music/url (POST)   QQ: tang.api.s01s.cn (GET, 按 songmid)
//   搜索:   QQ smartbox(官方联想接口) / 酷我官方搜索(取 rid 后走 nmobi 官方取链)
// 返回: { ok, url, source, matched, quality }，失败返回 { ok:false }，网站自动落回仓库线路。
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function norm(s) {
  return (s || '').toLowerCase().replace(/[\s\-_·・.．,，、'"'"'’‘“”()（）【】\[\]《》<>~～!！?？:：;；/\\|]+/g, '');
}
function score(wantT, wantA, gotT, gotA) {
  const t = norm(wantT), a = norm(wantA), gt = norm(gotT), ga = norm(gotA);
  let s = 0;
  if (gt === t) s += 60; else if (gt.includes(t) || t.includes(gt)) s += 30;
  if (a && ga) { if (ga === a) s += 40; else if (ga.includes(a) || a.includes(ga)) s += 20; }
  return s;
}
async function fetchT(url, opts = {}, ms = 6000) {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); }
  finally { clearTimeout(id); }
}
const https = u => (u && u.startsWith('http://') ? 'https://' + u.slice(7) : u);

// ---------- 网易云 ----------
async function searchWY(title, artist) {
  // wwwweb 自带搜索（若其服务支持按关键词取 wy 歌曲）
  try {
    const r = await fetchT('https://c.wwwweb.top/music/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ keyword: (artist ? artist + ' ' : '') + title, source: 'wy', page: 1, limit: 8 }),
    }, 5000);
    if (r.ok) {
      const d = await r.json();
      const list = (d && (d.data || d.list || d.songs)) || [];
      if (Array.isArray(list) && list.length) {
        let best = null, bs = -1;
        for (const it of list) {
          const sc = score(title, artist, it.name || it.title, it.artist || it.singer || (it.ar && it.ar[0] && it.ar[0].name) || '');
          if (sc > bs) { bs = sc; best = it; }
        }
        if (best && bs >= 55) return String(best.id || best.musicId || best.songId || '');
      }
    }
  } catch (e) { /* fallthrough */ }
  return '';
}
async function resolveWY(id) {
  const r = await fetchT('https://c.wwwweb.top/music/url', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ source: 'wy', musicId: id, quality: '320k' }),
  });
  if (!r.ok) throw new Error('wy http ' + r.status);
  const d = await r.json();
  if (d && d.code === 200 && d.url) return d.url;
  throw new Error('wy no url');
}

// ---------- QQ 音乐 ----------
async function searchTX(title, artist) {
  const key = encodeURIComponent((artist ? artist + ' ' : '') + title);
  const r = await fetchT(`https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=${key}&format=json&inCharset=utf-8&outCharset=utf-8`,
    { headers: { 'User-Agent': UA, 'Referer': 'https://y.qq.com/' } });
  if (!r.ok) throw new Error('tx search http ' + r.status);
  const d = await r.json();
  const list = (((d || {}).data || {}).song || {}).itemlist || [];
  let best = null, bs = -1;
  for (const it of list) {
    const sc = score(title, artist, it.name, it.singer);
    if (sc > bs) { bs = sc; best = it; }
  }
  if (!best || bs < 55) throw new Error('tx no match');
  return { mid: best.mid, name: best.name, singer: best.singer };
}
async function resolveTX(mid) {
  const r = await fetchT(`https://tang.api.s01s.cn/music_open_api.php?mid=${encodeURIComponent(mid)}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('tx http ' + r.status);
  const d = await r.json();
  for (const f of ['song_play_url_hq', 'song_play_url', 'song_play_url_standard']) {
    if (d && typeof d[f] === 'string' && d[f]) return d[f];
  }
  throw new Error('tx no url');
}

// ---------- 酷我 ----------
async function searchKW(title, artist) {
  const q = encodeURIComponent((artist ? artist + ' ' : '') + title);
  const r = await fetchT(`https://search.kuwo.cn/r.s?client=kt&all=${q}&pn=0&rn=5&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`,
    { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('kw search http ' + r.status);
  const d = await r.json();
  const list = (d && d.abslist) || [];
  let best = null, bs = -1;
  for (const it of list) {
    const sc = score(title, artist, it.SONGNAME, it.ARTIST);
    if (sc > bs) { bs = sc; best = it; }
  }
  if (!best || bs < 55) throw new Error('kw no match');
  return { rid: String(best.MUSICRID || '').replace('MUSIC_', ''), name: best.SONGNAME, singer: best.ARTIST };
}
async function resolveKW(rid) {
  const r = await fetchT(`https://nmobi.kuwo.cn/mobi.s?f=web&user=0&source=kwplayerhd_ar_6.6.6.6_tianbao_T1A_qirui.apk&type=convert_url_with_sign&rid=${encodeURIComponent(rid)}&br=320kmp3`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android) AppleWebKit/537.36' } });
  if (!r.ok) throw new Error('kw http ' + r.status);
  const d = await r.json();
  const u = d && d.data && d.data.url;
  if (u && u !== 'None') return u;
  throw new Error('kw no url');
}

async function resolveAll(title, artist) {
  const tries = [];
  // 1) 网易云
  try {
    const id = await searchWY(title, artist);
    if (id) { const url = await resolveWY(id); return { ok: true, url: https(url), source: 'wy', quality: '320k', matched: title }; }
    tries.push('wy:无搜索结果');
  } catch (e) { tries.push('wy:' + e.message); }
  // 2) QQ
  try {
    const hit = await searchTX(title, artist);
    const url = await resolveTX(hit.mid);
    return { ok: true, url: https(url), source: 'tx', quality: '320k', matched: hit.name + ' - ' + hit.singer };
  } catch (e) { tries.push('tx:' + e.message); }
  // 3) 酷我
  try {
    const hit = await searchKW(title, artist);
    const url = await resolveKW(hit.rid);
    return { ok: true, url: https(url), source: 'kw', quality: '320k', matched: hit.name + ' - ' + hit.singer };
  } catch (e) { tries.push('kw:' + e.message); }
  return { ok: false, tries };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const u = new URL(request.url);
    if (u.pathname === '/' || u.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, service: 'music-source', ts: Date.now() }), { headers: CORS });
    }
    if (u.pathname !== '/resolve') {
      return new Response(JSON.stringify({ ok: false, error: 'not found' }), { status: 404, headers: CORS });
    }
    const title = (u.searchParams.get('title') || '').trim();
    const artist = (u.searchParams.get('artist') || '').trim();
    if (!title) return new Response(JSON.stringify({ ok: false, error: 'title required' }), { status: 400, headers: CORS });
    const cacheKey = new Request(`https://cache.internal/resolve?v=1&title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`);
    const cache = (typeof caches !== 'undefined') ? caches.default : null;
    let hit = cache ? await cache.match(cacheKey) : null;
    if (hit) return hit;
    const result = await resolveAll(title, artist);
    const resp = new Response(JSON.stringify(result), {
      headers: { ...CORS, 'Cache-Control': result.ok ? 'public, max-age=1200' : 'public, max-age=120' },
    });
    if (result.ok && cache) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  },
};
