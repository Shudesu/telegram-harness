// Bot API 10.4 HTML widget: a booking card drawn inside the message (sendWidget).
// Primary source: https://core.telegram.org/bots/api#sendwidget and https://core.telegram.org/bots/widgets
//  * html 1-32768 bytes, at most 4096 bytes after zlib level 9 (checked in the tests)
//  * the widget asks the bot with TelegramWidget.request(data) (1-64 bytes) -> Update.widget_query
//  * the bot answers with answerWidgetQuery (within 15 s) and changes the state with
//    editMessageWidgetData(chat_data); the widget redraws on chatDataChanged
//  * clients without widget support show the message as unsupported media with its caption, so the
//    caption and the inline button under it lead to the existing rich-message flow.
import {SCHEMAS} from './schema.mjs';

export const WIDGET_BUTTON = '✨ウィジェット';
export const FALLBACK_DATA = 'wfb';
export const LEGACY_TEXT = '📅 予約デモ';
export const DAY_SLOTS = ['10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];
export const EVE_SLOTS = ['18:00', '19:00', '20:00', '21:00', '22:00', '22:30'];
const evening = c => Number(c.slots[0].slice(11, 13)) >= 18;
const WD = ['日', '月', '火', '水', '木', '金', '土'];

// The next three days in JST, as the bot will validate them: [{iso:'2026-11-12', label:'11/12(木)'}].
export function nextDates(now = Date.now(), n = 3) {
  const out = [];
  for (let k = 1; k <= n; k++) {
    const d = new Date(now + 9 * 3600000 + k * 86400000);
    out.push({iso: d.toISOString().slice(0, 10), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`});
  }
  return out;
}

// Industry index the bottom keyboard / widget may preselect.
export const industryCount = SCHEMAS.length;

const J = v => JSON.stringify(v);
export function widgetHtml(dates) {
  const N = SCHEMAS.map(c => c.short), E = SCHEMAS.map(c => evening(c) ? 1 : 0);
  const S = SCHEMAS.map(c => c.services[0].brief), Y = SCHEMAS.map(c => c.services[0].yen);
  const D = dates.map(d => d.label);
  return `<style>
body{margin:0;padding:0;font-family:system-ui,sans-serif}
.h{position:relative;padding:12px 14px 14px;color:#fff;background:linear-gradient(135deg,#6a5cff,#d64bd0 55%,#ff9a62)}
.h b{display:block;font-size:1.15em}.h span{font-size:.8em;color:rgba(255,255,255,.88)}
.h svg{position:absolute;right:12px;top:10px}
.w{padding:6px 10px 10px}
.t{font-size:.75em;color:var(--tg-theme-hint-color);margin:8px 2px 4px}
.g{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
button{border:0;border-radius:10px;padding:9px 2px;font-size:.85em;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color)}
button.on{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}
.c{display:block;width:100%;margin-top:10px;padding:12px;font-weight:600;color:#fff;background:linear-gradient(90deg,#6a5cff,#d64bd0)}
.p{display:flex;justify-content:space-between;margin-top:10px;padding:8px 10px;border-radius:10px;border:1px dashed var(--tg-theme-hint-color);font-size:.85em}
.k{text-align:center;padding:10px 0}.k b{font-size:1.3em}
.m{font-size:.75em;color:var(--tg-theme-hint-color);text-align:center;margin-top:6px}
</style><div class=h><svg width=44 height=44 viewBox="0 0 44 44"><rect x=4 y=8 width=36 height=32 rx=7 fill="rgba(255,255,255,.25)"/><rect x=4 y=8 width=36 height=10 rx=5 fill="rgba(255,255,255,.55)"/><circle cx=31 cy=30 r=6 fill="#fff"/><path d="M28 30l2 2 4-4" stroke="#d64bd0" stroke-width=2 fill=none /></svg><b>予約カード</b><span id=s></span></div><div class=w id=m></div><div class=m id=x></div><script>
var W=window.TelegramWidget,N=${J(N)},E=${J(E)},S=${J(S)},Y=${J(Y)},D=${J(D)},T=[${J(DAY_SLOTS)},${J(EVE_SLOTS)}],a={i:0,d:0,t:-1},cd=null,busy=0;
function $(i){return document.getElementById(i)}
function rd(){try{cd=JSON.parse(W&&W.chatData)}catch(e){cd=null}}
function hp(){try{W.HapticFeedback.selectionChanged()}catch(e){}}
function msg(t){$('x').textContent=t}
function grid(t,L,cur,f){var h=document.createElement('div');h.innerHTML='<div class=t>'+t+'</div>';var g=document.createElement('div');g.className='g';L.forEach(function(l,k){var b=document.createElement('button');b.textContent=l;if(k==cur)b.className='on';b.onclick=function(){hp();f(k);R()};g.appendChild(b)});h.appendChild(g);return h}
function yen(n){return '¥'+String(n).replace(/\\B(?=(\\d{3})+$)/g,',')}
function q(d){if(!W){msg('Telegramアプリ内で押してください');return}if(busy)return;busy=1;msg('送信中…');W.request(d).then(function(r){busy=0;msg('');var v=null;try{v=JSON.parse(r.result)}catch(e){}if(v&&v.e){msg(v.e);return}cd=v&&v.r?v:null;R()},function(e){busy=0;msg('送れませんでした（'+e.code+'）')})}
function R(){var m=$('m');m.innerHTML='';
if(cd&&cd.r){var i=cd.i;$('s').textContent=N[i]+'・予約確定';m.innerHTML='<div class=k>✅ <b>予約確定（ダミー）</b><div class=t>受付 '+cd.r+'</div></div><div class=p><span>'+N[i]+'・'+S[i]+'</span><span>'+D[cd.d]+' '+T[E[i]][cd.t]+'</span></div><div class=p><span>💳 お支払い（ダミー）</span><b>'+yen(Y[i])+'</b></div>';var b=document.createElement('button');b.className='c';b.textContent='↺ 別の枠で取り直す';b.onclick=function(){q('r')};m.appendChild(b);return}
$('s').textContent=N[a.i]+'・'+S[a.i]+'・'+yen(Y[a.i]);
m.appendChild(grid('業態',N,a.i,function(k){a.i=k;a.t=-1}));
m.appendChild(grid('日付',D,a.d,function(k){a.d=k}));
m.appendChild(grid('時間',T[E[a.i]],a.t,function(k){a.t=k}));
var p=document.createElement('div');p.className='p';p.innerHTML='<span>💳 お支払い（ダミー・実請求なし）</span><b>'+yen(Y[a.i])+'</b>';m.appendChild(p);
var c=document.createElement('button');c.className='c';c.textContent=a.t<0?'時間を選んでください':'この枠で予約する';if(a.t<0)c.disabled=true;c.onclick=function(){q('b'+a.i+a.d+a.t)};m.appendChild(c)}
if(W){W.onEvent('chatDataChanged',function(){rd();R()});W.ready()}
rd();R();
</script>`;
}

export const CAPTION = '📅 予約カード（ウィジェット）\n業態→日付→時間をタップ→その場でダミー予約確定。実予約・実決済なし。\n表示されない場合は下の「従来版で開く」へ。';

// The state the bot keeps per widget message; the widget's own chat_data is only a mirror of it.
export function parseRequest(data) {
  if (data === 'r') return {reset: true};
  const m = /^b([0-8])([0-2])([0-5])$/.exec(data ?? '');
  return m ? {i: Number(m[1]), d: Number(m[2]), t: Number(m[3])} : null;
}

export function slotsFor(i) { return evening(SCHEMAS[i]) ? EVE_SLOTS : DAY_SLOTS; }
