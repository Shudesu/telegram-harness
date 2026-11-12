// t78u widget catalogue. Every entry is a pure function of (state, now) → {html, chat_data?,
// caption}; the bot keeps the authoritative state and mirrors it into chat_data with
// editMessageWidgetData, so the booking flow, votes, stamps and the tour never add messages.
// Sizes are checked by the test suite (raw ≤ 32768 B, zlib-9 ≤ 4096 B, chat_data ≤ 1024 B).
import {SCHEMAS} from '../schema.mjs';
import {widget} from './ui.mjs';
import {APP_PLANS} from './plans.mjs';

const J = v => JSON.stringify(v);
const WD = ['日', '月', '火', '水', '木', '金', '土'];
export const DAY_SLOTS = ['10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];
export const EVE_SLOTS = ['18:00', '19:00', '20:00', '21:00', '22:00', '22:30'];
const evening = c => Number(c.slots[0].slice(11, 13)) >= 18;
export const slotsOf = i => evening(SCHEMAS[i]) ? EVE_SLOTS : DAY_SLOTS;
const jst = now => new Date(now + 9 * 3600000);

// The next n days in JST, starting tomorrow.
export function nextDates(now = Date.now(), n = 3) {
  const out = [];
  for (let k = 1; k <= n; k++) {
    const d = new Date(jst(now).getTime() + k * 86400000);
    out.push({iso: d.toISOString().slice(0, 10), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`});
  }
  return out;
}
const staffName = p => p.name.replace('・デモ', '');

// ---------------------------------------------------------------- booking (all steps in one card)
export const BOOK_STEPS = ['業態', 'メニュー', 'スタッフ', '日付', '時間', '確認'];
function booking(_, now) {
  const N = SCHEMAS.map(c => c.short), E = SCHEMAS.map(c => evening(c) ? 1 : 0);
  const V = SCHEMAS.map(c => c.services.map(s => [s.brief, s.minutes, s.yen]));
  const P = SCHEMAS.map(c => c.staff.map(staffName));
  const D = nextDates(now).map(d => d.label);
  return widget({icon: '📅', title: '予約', sub: '業態から選んでください', chip: '1/6',
    css: '.cb{display:block;width:100%;text-align:left;padding:10px 12px;margin-top:6px}.cb.on .mu{color:inherit}.av{display:inline-flex;width:26px;height:26px;border-radius:50%;align-items:center;justify-content:center;color:#fff;background:var(--gr);margin-right:8px;font-size:12px}.sm{padding:4px 10px;font-size:12px}.ng{background:var(--ng);color:#fff}',
    js: `var N=${J(N)},E=${J(E)},V=${J(V)},P=${J(P)},D=${J(D)},T=[${J(DAY_SLOTS)},${J(EVE_SLOTS)}],H=${J(['🏷 業態', '🍽 メニュー', '👤 スタッフ', '📅 日付', '🕒 時間', '🧾 確認'])},a={s:0,i:-1,v:-1,p:-1,d:-1,t:-1},cx=0,lk=null;
function go(s){a.s=s;R()}
function pick(L,cur,f){var g=el('div','g');L.forEach(function(l,k){g.appendChild(bt(l,k==cur?'on':'',function(){f(k)}))});return g}
function rows(c,L){L.forEach(function(r){var x=el('div','row');x.appendChild(el('span','mu',r[0]));x.appendChild(el('b','',r[1]));c.appendChild(x)})}
function info(b){return [['業態',N[b.i]],['メニュー',V[b.i][b.v][0]+'・'+V[b.i][b.v][1]+'分'],['スタッフ',P[b.i][b.p]],['日時',D[b.d]+' '+T[E[b.i]][b.t]],['料金（ダミー）',yen(V[b.i][b.v][2])]]}
function R(){var m=$('m'),c=$('c');m.innerHTML='';c.hidden=false;
if(cd&&cd.r){c.textContent=cd.st=='cx'?'取消済':'予約済';$('s').textContent='受付 '+cd.r;var k=el('div','cd');k.appendChild(el('div','big',cd.st=='cx'?'✖ キャンセル済み':'✅ 予約完了'));rows(k,info(cd));m.appendChild(k);
if(lk)m.appendChild(el('div','m','🔍 '+lk));
if(cx){m.appendChild(el('div','t','この予約を取り消しますか？（ダミー）'));var y=el('div','g2');y.appendChild(bt('戻る','',function(){cx=0;R()}));y.appendChild(bt('取り消す','ng',function(){q('x',function(){cx=0;lk=null;hp('warning');R()})}));m.appendChild(y);return}
var g=el('div','g');g.appendChild(bt('🔍 照会','',function(){q('l',function(v){lk=v.l;hp('success');R()})}));if(cd.st!='cx')g.appendChild(bt('✖ 取消','',function(){cx=1;R()}));g.appendChild(bt('↺ 新規','',function(){q('r',function(){a.s=0;cx=0;lk=null;R()})}));m.appendChild(g);return}
c.textContent=(a.s+1)+'/6';$('s').textContent=a.i<0?'業態から選んでください':N[a.i]+(a.v<0?'':'・'+V[a.i][a.v][0])+(a.p<0?'':'・'+P[a.i][a.p]);
var p=el('div','pg'),i=el('i');i.style.width=(a.s+1)*100/6+'%';p.appendChild(i);m.appendChild(p);
var h=el('div','row');h.appendChild(el('b','',H[a.s]));if(a.s)h.appendChild(bt('‹ 戻る','sm',function(){go(a.s-1)}));m.appendChild(h);
if(a.s==0)m.appendChild(pick(N,a.i,function(k){if(k!=a.i){a.v=a.p=a.t=-1}a.i=k;go(1)}));
if(a.s==1)V[a.i].forEach(function(v,k){var b=bt('',k==a.v?'cb on':'cb',function(){a.v=k;go(2)});b.appendChild(el('b','',v[0]));b.appendChild(el('div','mu',v[1]+'分・'+yen(v[2])+'（ダミー）'));m.appendChild(b)});
if(a.s==2)P[a.i].forEach(function(n,k){var b=bt('',k==a.p?'cb on':'cb',function(){a.p=k;go(3)});b.appendChild(el('span','av',n[0]));b.appendChild(el('b','',n));b.appendChild(el('span','mu','　AI生成の架空スタッフ'));m.appendChild(b)});
if(a.s==3)m.appendChild(pick(D,a.d,function(k){a.d=k;a.t=-1;go(4)}));
if(a.s==4)m.appendChild(pick(T[E[a.i]],a.t,function(k){a.t=k;go(5)}));
if(a.s==5){var k=el('div','cd');rows(k,info(a));m.appendChild(k);m.appendChild(el('div','m','💳 支払いはダミー表示・実請求なし'));m.appendChild(bt('予約を確定する','cta',function(){q('b'+a.i+a.v+a.p+a.d+a.t,function(){hp('success')})}))}}`});
}
export function parseBooking(data) {
  const m = /^b([0-8])([01])([01])([0-2])([0-5])$/.exec(data ?? '');
  if (!m) return null;
  const [i, v, p, d, t] = m.slice(1).map(Number);
  if (!SCHEMAS[i].services[v] || !SCHEMAS[i].staff[p]) return null;
  return {i, v, p, d, t};
}
export function bookingText(b, dates) {
  const c = SCHEMAS[b.i];
  return `${c.short}・${c.services[b.v].brief}・${staffName(c.staff[b.p])}・${dates[b.d] ?? ''} ${slotsOf(b.i)[b.t]}`;
}

// ---------------------------------------------------------------- guided tour (/start)
export const TOUR = [
  {e: '📅', t: '予約はチャットの中で完結', d: '業態→メニュー→スタッフ→日付→時間→確認まで、1枚のカードが書き換わって進みます。', h: '『体験する』で予約カードが届きます', k: '予約を体験'},
  {e: '💳', t: '会員登録とStars決済', d: 'プラン比較→Telegram Starsで登録→会員証まで。お支払いはTelegram公式の支払い画面で行います（規約は /terms）。', h: '入力欄左の『💳 決済・会員』でアプリ版も開けます', k: 'プランを見る'},
  {e: '🎨', t: 'リッチメッセージ', d: '動画ヘッダー・装飾テキスト・ボタンを組み合わせた配信用メッセージを作れます。', h: '『体験する』で見本が届きます', k: '見本を見る'},
  {e: '🤖', t: '自動応答', d: 'よくある質問に24時間自動で返答。チャットに「料金は？」と送っても答えます。', h: '『体験する』でFAQボットが届きます', k: 'FAQを試す'},
  {e: '🛠', t: 'あなたのBotを1タップ作成', d: '/newbot で自分専用のBotを作成し、予約テンプレまで自動で設定します。', h: '『体験する』で作成ボタンが出ます', k: 'Bot作成へ'},
  {e: '📊', t: '管理ダッシュボード', d: '売上・予約数・会員数をチャット内で確認。会員の承認ルールは管理APIで操作します。', h: '『体験する』でダミーの管理画面が届きます', k: '管理画面を見る'},
];
function tour() {
  return widget({icon: '🎓', title: 'はじめてガイド', sub: 'できることを6ステップで', chip: '1/6',
    css: '.dt{display:flex;gap:5px;justify-content:center;margin:2px 0 10px}.dt i{width:7px;height:7px;border-radius:50%;background:var(--s2)}.dt i.on{width:18px;border-radius:4px;background:var(--gr)}.dt i.ok{background:var(--ok)}.em{font-size:30px}.cd .row{justify-content:flex-start;gap:10px}.an{margin-top:8px;padding:8px 10px;border-radius:10px;border:1px dashed var(--bt);font-size:12px}.sm{padding:6px;font-size:12px;background:none;color:var(--ht)}',
    js: `var S=${J(TOUR.map(s => [s.e, s.t, s.d, s.h, s.k]))},n=S.length;
function R(){var m=$('m'),s=cd&&cd.s||0,x=cd&&cd.x||0,dn=cd&&cd.d;m.innerHTML='';$('c').hidden=false;
var dt=el('div','dt');for(var k=0;k<n;k++){var i=el('i',k==s&&!dn?'on':x>>k&1?'ok':'');dt.appendChild(i)}m.appendChild(dt);
if(dn){$('c').textContent='完了';$('s').textContent='ガイドを完了しました';var c=el('div','cd');c.appendChild(el('div','big','🎉 おつかれさまでした'));S.forEach(function(t,k){c.appendChild(el('div','mu',(x>>k&1?'✅ ':'▫️ ')+t[1]))});m.appendChild(c);m.appendChild(el('div','m','下の入力欄のボタンからいつでも再開できます'));var g=el('div','g2');g.appendChild(bt('✨ ウィジェット一覧','',function(){q('w')}));g.appendChild(bt('↺ 最初から','',function(){q('0')}));m.appendChild(g);return}
var t=S[s];$('c').textContent=(s+1)+'/'+n;$('s').textContent=t[1];
var c=el('div','cd');var r=el('div','row');r.appendChild(el('span','em',t[0]));r.appendChild(el('b','',t[1]));c.appendChild(r);c.appendChild(el('div','',t[2]));var an=el('div','an','👉 '+t[3]);c.appendChild(an);m.appendChild(c);
m.appendChild(bt('▶ '+t[4],'cta',function(){q('g',function(){hp('success')})}));
var g=el('div','g');g.appendChild(bt('‹ 戻る','',function(){q('p')}));g.appendChild(bt('⏭ スキップ','',function(){q('k')}));g.appendChild(bt(s+1<n?'次へ ›':'完了 ✓','on',function(){q('n')}));m.appendChild(g);
m.appendChild(bt('↺ 最初から','sm',function(){q('0')}))}`});
}
export function tourCaption(st) {
  if (st.d) return '🎉 ガイド完了！\n入力欄の下のボタン（📅予約・✨ウィジェット・💳会員）からいつでも試せます。\n※予約はデモ（実予約なし）。会員プランのみ Stars で決済されます';
  const s = TOUR[st.s];
  return `🎓 はじめてガイド ${st.s + 1}/${TOUR.length}\n${s.e} ${s.t}\n${s.d}\n👉 ${s.h}\n※予約はデモ（実予約なし）。会員プランのみ Stars で決済されます`;
}

// ---------------------------------------------------------------- gallery
// Order is the gallery's (and the fallback keyboard's) order. `o` codes are what the gallery asks for.
export const GALLERY = [
  ['bk', '📅', '予約', '6ステップ予約'], ['ca', '🗓', 'カレンダー', '空き状況'], ['mn', '🍽', 'メニュー', 'カルーセル'],
  ['sf', '👤', 'スタッフ', '指名選択'], ['mc', '🪪', '会員証', 'QR風カード'], ['pl', '💎', 'プラン', '比較＋Stars'],
  ['vo', '🗳', '投票', 'アンケート'], ['sc', '🎟', 'スタンプ', 'クーポン'], ['da', '📊', '管理', 'ダッシュボード'],
  ['fq', '💬', 'FAQ', '自動応答'], ['cd', '⏳', 'カウント', '来店まで'], ['tu', '🎓', 'ガイド', '最初から'],
];
function gallery() {
  return widget({icon: '✨', title: 'ウィジェット一覧', sub: 'タップするとその場に届きます', chip: `${GALLERY.length}種`,
    css: '.g button{padding:8px 2px}.g b{display:block;font-size:20px}.g span{font-size:10px;color:var(--ht)}.g .on span{color:inherit}',
    js: `var G=${J(GALLERY.map(x => x.slice(1)))},sel=-1;
function R(){var m=$('m');m.innerHTML='';var g=el('div','g');G.forEach(function(x,k){var b=bt('',k==sel?'on':'',function(){sel=k;R();q('o'+k,function(){msg('↓ '+x[1]+' を送りました');hp('success')})});b.appendChild(el('b','',x[0]));b.appendChild(el('div','',x[1]));b.appendChild(el('span','',x[2]));g.appendChild(b)});m.appendChild(g)}`});
}

// ---------------------------------------------------------------- calendar
function calendar(_, now) {
  const start = jst(now), days = [];
  for (let k = 0; k < 21; k++) {
    const d = new Date(start.getTime() + k * 86400000);
    days.push([d.getUTCDate(), d.getUTCDay(), k === 0 ? 0 : (d.getUTCDate() * 7 + k) % 4]);
  }
  return widget({icon: '🗓', title: '予約カレンダー', sub: `${start.getUTCMonth() + 1}月・3週間分の空き（ダミー）`,
    css: '.cl{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center}.cl button{padding:6px 0;font-size:12px}.cl i{display:block;height:4px;width:4px;margin:2px auto 0;border-radius:50%}.a0{opacity:.35}.a1 i{background:var(--ng)}.a2 i{background:#f5a623}.a3 i{background:var(--ok)}.wd{font-size:10px;color:var(--ht)}',
    js: `var C=${J(days)},w='日月火水木金土',s=-1;
function R(){var m=$('m');m.innerHTML='';var g=el('div','cl');for(var k=0;k<7;k++)g.appendChild(el('div','wd',w[k]));for(var k=0;k<C[0][1];k++)g.appendChild(el('div'));C.forEach(function(d,k){var b=bt(String(d[0]),'a'+d[2]+(k==s?' on':''),function(){s=k;R()});b.appendChild(el('i'));if(!d[2])b.disabled=true;g.appendChild(b)});m.appendChild(g);
var L=el('div','m','🟢 空きあり　🟠 残りわずか　🔴 混雑');m.appendChild(L);
if(s>=0){var c=el('div','cd');c.appendChild(el('b','',C[s][0]+'日（'+w[C[s][1]]+'）の空き'));var t=el('div','g');['10:00','13:00','15:00','18:00','20:00','21:00'].slice(0,C[s][2]*2).forEach(function(x){t.appendChild(bt(x,'',function(){q('ob',function(){msg('↓ 予約カードを送りました')})}))});c.appendChild(t);m.appendChild(c)}}`});
}

// ---------------------------------------------------------------- menu carousel
const MENU = [['✂️', 'カット＋ブロー', 60, 4400, '似合わせカット。仕上げまで'], ['🎨', 'イルミナカラー', 90, 8800, '透明感のある発色'], ['💆', 'ヘッドスパ', 30, 3300, '炭酸泉でリフレッシュ'], ['✨', 'トリートメント', 45, 5500, '髪の内部まで集中補修']];
function menu() {
  return widget({icon: '🍽', title: 'メニュー', sub: '美容室の例（架空・ダミー価格）', chip: '1/4',
    css: '.ar{height:110px;border-radius:12px;background:var(--gr);display:flex;align-items:center;justify-content:center;font-size:48px}.dt{text-align:center;margin:6px 0;letter-spacing:4px;color:var(--ht)}',
    js: `var M=${J(MENU)},i=0;
function R(){var m=$('m'),x=M[i];m.innerHTML='';$('c').textContent=(i+1)+'/'+M.length;m.appendChild(el('div','ar',x[0]));var r=el('div','row');r.appendChild(el('b','big',x[1]));r.appendChild(el('b','',yen(x[3])));m.appendChild(r);m.appendChild(el('div','mu',x[2]+'分・'+x[4]));
var d='';for(var k=0;k<M.length;k++)d+=k==i?'●':'○';m.appendChild(el('div','dt',d));
var g=el('div','g');g.appendChild(bt('‹ 前','',function(){i=(i+M.length-1)%M.length;R()}));g.appendChild(bt('予約へ','on',function(){q('ob',function(){msg('↓ 予約カードを送りました')})}));g.appendChild(bt('次 ›','',function(){i=(i+1)%M.length;R()}));m.appendChild(g)}`});
}

// ---------------------------------------------------------------- staff picker
const STAFF = [['蒼', 'トップスタイリスト', 4.9, 'カット・メンズ'], ['凛', 'カラーリスト', 4.8, 'ハイトーン'], ['楓', 'スタイリスト', 4.7, 'パーマ・縮毛'], ['澪', 'アシスタント', 4.6, 'ヘッドスパ']];
function staff() {
  return widget({icon: '👤', title: 'スタッフ指名', sub: 'AI生成の架空スタッフです',
    css: '.sf{display:flex;align-items:center;gap:10px;width:100%;text-align:left;margin-top:6px;padding:8px 10px}.av{width:34px;height:34px;border-radius:50%;background:var(--gr);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex:none}.sf.on .mu{color:inherit}',
    js: `var P=${J(STAFF)},s=-1;
function R(){var m=$('m');m.innerHTML='';P.forEach(function(p,k){var b=bt('',k==s?'sf on':'sf',function(){s=k;R()});b.appendChild(el('div','av',p[0]));var t=el('div');t.appendChild(el('b','',p[0]+'・'+p[1]));t.appendChild(el('div','mu','★'+p[2]+'　'+p[3]));b.appendChild(t);m.appendChild(b)});
var c=bt(s<0?'スタッフを選んでください':P[s][0]+'さんを指名して予約','cta',function(){q('ob',function(){msg('↓ 予約カードを送りました')})});c.disabled=s<0;m.appendChild(c)}`});
}

// ---------------------------------------------------------------- membership card (QR-style)
function memberCard(st) {
  return widget({icon: '🪪', title: '会員証', sub: 'デモ会員証（実在の会員資格ではありません）',
    css: '.mc{border-radius:16px;padding:14px;color:#fff;background:var(--gr);display:flex;gap:12px;align-items:center}.mc .q{background:#fff;border-radius:8px;padding:5px;flex:none}.mc b{font-size:16px}.mc .n{font:12px monospace;opacity:.9}',
    js: `var sd=1;
function qr(seed){var n=21,s='<svg width=96 height=96 viewBox="0 0 21 21">',x=seed*9301+49297;function f(a,b){s+='<rect x='+a+' y='+b+' width=7 height=7 fill=#111 /><rect x='+(a+1)+' y='+(b+1)+' width=5 height=5 fill=#fff /><rect x='+(a+2)+' y='+(b+2)+' width=3 height=3 fill=#111 />'}
for(var i=0;i<n;i++)for(var j=0;j<n;j++){if((i<8&&j<8)||(i<8&&j>12)||(i>12&&j<8))continue;x=(x*1103515245+12345)%2147483648;if(x%3==0)s+='<rect x='+j+' y='+i+' width=1 height=1 fill=#111 />'}f(0,0);f(14,0);f(0,14);return s+'</svg>'}
function R(){var m=$('m'),v=cd||{};m.innerHTML='';var c=el('div','mc'),q2=el('div','q');q2.innerHTML=qr(sd+(v.no?v.no.length:0));c.appendChild(q2);var t=el('div');t.appendChild(el('div','mu',''));t.appendChild(el('b','',v.pl?'⭐ '+v.pl+'会員':'ゲスト'));t.appendChild(el('div','n','No. '+(v.no||'TEST-0000-0000')));t.appendChild(el('div','n',v.pl?(v.rn?'次回更新 ':'有効期限 ')+v.until:(v.lv?'未登録':'未登録（デモ）')));c.appendChild(t);m.appendChild(c);
if(!v.lv){var p=el('div','cd');var r=el('div','row');r.appendChild(el('span','mu','ポイント（ダミー）'));r.appendChild(el('b','',(v.pt||120)+' pt'));p.appendChild(r);m.appendChild(p)}
var g=el('div','g2');g.appendChild(bt('🔄 QRを更新','',function(){sd++;R()}));g.appendChild(bt('📋 番号コピー','',function(){try{W.copyText(v.no||'TEST-0000-0000');msg('コピーしました')}catch(e){msg('コピーできませんでした')}}));m.appendChild(g);
m.appendChild(el('div','m',v.pl?(v.lv?'お問い合わせ・返金は /paysupport':''):(v.lv?'入力欄左の『💳 決済・会員』から登録できます':'入力欄左の『💳 決済・会員』から登録（テスト）できます')));if(v.lv)$('s').textContent=v.pl?'Telegram Stars でお支払い済みの会員資格':'会員プランは『💳 決済・会員』から'}`});
}

// ---------------------------------------------------------------- plan comparison + Stars (test)
// [name, stars, short benefits, auto-renew] — the same plans the Mini App sells (plans.mjs).
const SHORT = {light: ['週刊ニュース解説', 'テンプレ集'], standard: ['＋月2回の勉強会', '＋個別質問 月3件'], premium: ['＋少人数ハンズオン', '＋優先サポート']};
export const PLANS = APP_PLANS.map(p => [p.name, p.stars, SHORT[p.id] ?? p.f.slice(0, 2), p.recurring ? 1 : 0]);
function plans() {
  return widget({icon: '💎', title: 'プラン比較', sub: 'Stars決済はテスト表示のみ・実請求なし',
    css: '.pl{display:block;width:100%;text-align:left;margin-top:6px;padding:9px 12px}.pl.on .mu{color:inherit}.bd{float:right;font-weight:700}.ok{background:var(--ok);color:#fff}.rn{font-size:10px;margin-left:6px;opacity:.8}',
    js: `var P=${J(PLANS)},s=1;
function R(){var m=$('m'),lv=cd&&cd.lv;m.innerHTML='';if(lv)$('s').textContent='Telegram Stars・30日ごと';if(cd&&cd.r){var c=el('div','cd');c.appendChild(el('div','big','✅ テスト決済完了'));c.appendChild(el('div','',P[cd.p][0]+'プラン・⭐'+P[cd.p][1]+'/30日'));c.appendChild(el('div','mu','受付 '+cd.r+'（実請求なし・Starsは動いていません）'));m.appendChild(c);m.appendChild(bt('↺ プランを選び直す','',function(){q('y9')}));return}
if(lv&&cd.go!=null&&P[cd.go]){var g=el('div','cd');g.appendChild(el('div','big','📩 申込ボタンを送りました'));g.appendChild(el('div','',P[cd.go][0]+'プラン・⭐'+P[cd.go][1]+'/30日'));g.appendChild(el('div','mu','チャットの『⭐ 申し込む』から Telegram 公式の支払い画面へ進めます'));m.appendChild(g);m.appendChild(bt('↺ ほかのプランを見る','',function(){q('y9')}));return}
P.forEach(function(p,k){var b=bt('',k==s?'pl on':'pl',function(){s=k;R()});var h=el('div');h.appendChild(el('b','',p[0]));if(p[3])h.appendChild(el('span','rn','🔁自動更新'));h.appendChild(el('span','bd','⭐'+p[1]+'/30日'));b.appendChild(h);b.appendChild(el('div','mu',p[2].join('・')));m.appendChild(b)});
m.appendChild(bt(lv?'⭐ '+P[s][0]+'を申し込む':'⭐ '+P[s][1]+' Starsで登録（テスト）','cta',function(){q('y'+s,function(){hp('success')})}));if(lv)m.appendChild(el('div','m','お申し込み前に /terms をご確認ください'))}`});
}

// ---------------------------------------------------------------- poll
export const POLL = {q: '次に欲しい機能は？', o: ['LINE連携', '多言語対応', 'AI自動返信', 'POS連携'], base: [12, 9, 15, 6]};
function poll() {
  return widget({icon: '🗳', title: 'アンケート', sub: POLL.q,
    css: '.vb{position:relative;display:block;width:100%;text-align:left;margin-top:6px;padding:10px 12px;overflow:hidden}.vb i{position:absolute;left:0;top:0;bottom:0;background:var(--bt);opacity:.18}.vb span{position:relative}.vb b{position:relative;float:right}',
    js: `var O=${J(POLL.o)};
function R(){var m=$('m'),c=cd&&cd.c,t=0;m.innerHTML='';if(c)c.forEach(function(v){t+=v});O.forEach(function(o,k){var b=bt('','vb'+(cd&&cd.m==k?' on':''),function(){q('v'+k,function(){hp('success')})});if(c){var i=el('i');i.style.width=Math.round(c[k]*100/t)+'%';b.appendChild(i);b.appendChild(el('b','',Math.round(c[k]*100/t)+'%'))}b.appendChild(el('span','',o));m.appendChild(b)});
m.appendChild(el('div','m',c?'合計 '+t+'票（ダミーの集計を含む）・押し直しで変更':'タップで投票'))}`});
}

// ---------------------------------------------------------------- stamp card + coupon
function stamps() {
  return widget({icon: '🎟', title: 'スタンプカード', sub: '5個でクーポン（デモ）',
    css: '.sg{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:4px 0 8px}.sp{aspect-ratio:1;border-radius:50%;border:2px dashed var(--ht);display:flex;align-items:center;justify-content:center;font-size:16px}.sp.on{border:0;background:var(--gr);color:#fff}.cp{border:2px dashed var(--ok);border-radius:12px;padding:10px;text-align:center}',
    js: `function R(){var m=$('m'),n=cd&&cd.n||0;m.innerHTML='';$('c').hidden=false;$('c').textContent=n+'/10';var g=el('div','sg');for(var k=0;k<10;k++)g.appendChild(el('div',k<n?'sp on':'sp',k<n?'★':k==4?'🎁':''));m.appendChild(g);
if(cd&&cd.cp){var c=el('div','cp');c.appendChild(el('b','','🎉 10%OFFクーポン'));c.appendChild(el('div','mu',cd.cp+'（デモ・実店舗なし）'));m.appendChild(c)}
var r=el('div','g2');r.appendChild(bt(n<10?'スタンプを押す':'満了しました','on',function(){if(n<10)q('s',function(){hp('success')})}));r.appendChild(bt('↺ リセット','',function(){q('s0')}));m.appendChild(r)}`});
}

// ---------------------------------------------------------------- dashboard
function dashboard() {
  return widget({icon: '📊', title: '管理ダッシュボード', sub: 'ダミーデータ・オーナー向け表示例',
    css: '.k{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}.k .cd b{display:block;font-size:17px}.up{color:var(--ok);font-size:11px}.ch2{margin-top:8px}',
    js: `var D={w:{l:'月火水木金土日',s:[42,55,38,61,72,96,88],k:[['売上','¥452,000','+12%'],['予約数','128件','+8%'],['新規会員','23人','+15%'],['リピート率','64%','+3pt']]},m:{l:'1234',s:[310,360,342,420],k:[['売上','¥1.86M','+9%'],['予約数','512件','+6%'],['新規会員','87人','+11%'],['リピート率','61%','+2pt']]}},v='w';
function R(){var m=$('m'),d=D[v];m.innerHTML='';var t=el('div','g2');t.appendChild(bt('週','w'==v?'on':'',function(){v='w';R()}));t.appendChild(bt('月','m'==v?'on':'',function(){v='m';R()}));m.appendChild(t);var k=el('div','k');k.style.marginTop='8px';d.k.forEach(function(x){var c=el('div','cd');c.appendChild(el('span','mu',x[0]));c.appendChild(el('b','',x[1]));c.appendChild(el('span','up','▲ '+x[2]));k.appendChild(c)});m.appendChild(k);
var mx=Math.max.apply(null,d.s),n=d.s.length,w=280/n,s='<svg width=100% height=90 viewBox="0 0 280 90"><defs><linearGradient id=gg x1=0 y1=1 x2=0 y2=0><stop offset=0 stop-color=#5b4bff /><stop offset=1 stop-color=#ff5ca8 /></linearGradient></defs>';d.s.forEach(function(y,i){var h=Math.round(y/mx*70);s+='<rect x='+(i*w+w*.2)+' y='+(76-h)+' width='+(w*.6)+' height='+h+' rx=3 fill="url(#gg)"/><text x='+(i*w+w/2)+' y=88 font-size=9 text-anchor=middle fill=currentColor opacity=.6>'+d.l[i]+'</text>'});var c=el('div','ch2');c.innerHTML=s+'</svg>';m.appendChild(c)}`});
}

// ---------------------------------------------------------------- FAQ bot
export const FAQ = [['料金は？', 'メニューごとに表示しています。デモの金額は架空で、実請求はありません。'], ['営業時間は？', 'デモ店舗は10:00〜22:30（業態により異なります）。'], ['キャンセルは？', '予約カードの『✖ 取消』からいつでも。キャンセル料はかかりません（デモ）。'], ['駐車場は？', 'デモ店舗のため実在の施設はありません。店舗設定で自由に回答を登録できます。']];
function faq() {
  return widget({icon: '💬', title: 'FAQボット', sub: '自動応答のデモ（24時間）',
    css: '.bb{max-width:85%;padding:7px 10px;border-radius:14px;margin:4px 0;font-size:13px}.me{margin-left:auto;background:var(--bt);color:var(--bx);border-bottom-right-radius:4px}.bo{background:var(--s2);border-bottom-left-radius:4px}.lg{min-height:150px}',
    js: `var F=${J(FAQ)},L=[];
function R(){var m=$('m');m.innerHTML='';var g=el('div','lg');if(!L.length)g.appendChild(el('div','bb bo','こんにちは！下の質問をタップしてください 🤖'));L.slice(-2).forEach(function(k){g.appendChild(el('div','bb me',F[k][0]));g.appendChild(el('div','bb bo',F[k][1]))});m.appendChild(g);
var c=el('div','g2');F.forEach(function(f,k){c.appendChild(bt(f[0],'',function(){L.push(k);R()}))});m.appendChild(c);m.appendChild(el('div','m','💡 チャット欄に「料金は？」と送っても自動で返答します'))}`});
}

// ---------------------------------------------------------------- countdown / status
function countdown(st) {
  return widget({icon: '⏳', title: 'ご来店まで', sub: st?.lb ?? '次の予約（ダミー）',
    css: '.cn{display:flex;gap:6px;justify-content:center;margin:6px 0 10px}.cn div{background:var(--s2);border-radius:10px;padding:8px 0;width:58px;text-align:center}.cn b{display:block;font-size:22px}.tl div{display:flex;gap:8px;align-items:center;margin:5px 0;font-size:13px}.tl i{width:10px;height:10px;border-radius:50%;background:var(--s2)}.tl .d i{background:var(--ok)}',
    js: `var tm=0;
function R(){var m=$('m'),at=cd&&cd.at||0,l=Math.max(0,at-Date.now()),u=[86400000,3600000,60000,1000],n=['日','時間','分','秒'];m.innerHTML='';var c=el('div','cn');u.forEach(function(x,k){var v=Math.floor(l/x);l-=v*x;var d=el('div');d.appendChild(el('b','',String(v)));d.appendChild(el('span','mu',n[k]));c.appendChild(d)});m.appendChild(c);
var t=el('div','tl');[['予約受付',1],['前日リマインド',at-Date.now()<86400000],['ご来店',at<=Date.now()]].forEach(function(s){var r=el('div',s[1]?'d':'');r.appendChild(el('i'));r.appendChild(el('span','',(s[1]?'✅ ':'')+s[0]));t.appendChild(r)});m.appendChild(t);
if(!tm)tm=setInterval(function(){if(!W||W.isActive)R()},1000)}`});
}

// kind → {build(state, now), caption, state(now, ctx) initial chat_data object or null}
export const KINDS = {
  bk: {build: booking, caption: '📅 予約カード：業態→メニュー→スタッフ→日付→時間→確認をこのカードの中で進めます（ダミー予約・実請求なし）。表示されない場合は下の「ボタン版」へ。'},
  tu: {build: tour, caption: null},
  ga: {build: gallery, caption: '✨ ウィジェット一覧：タップした機能がその場に届きます。表示されない場合は下のボタンからどうぞ。'},
  ca: {build: calendar, caption: '🗓 予約カレンダー（空き状況はダミー）'},
  mn: {build: menu, caption: '🍽 メニューカルーセル（架空の店舗・価格）'},
  sf: {build: staff, caption: '👤 スタッフ指名（AI生成の架空スタッフ）'},
  mc: {build: memberCard, caption: '🪪 会員証（デモ・実在の会員資格ではありません）'},
  pl: {build: plans, caption: '💎 プラン比較（Starsはテスト表示のみ・実請求なし）'},
  vo: {build: poll, caption: `🗳 アンケート：${POLL.q}`},
  sc: {build: stamps, caption: '🎟 スタンプカード（デモ）'},
  da: {build: dashboard, caption: '📊 管理ダッシュボード（ダミーデータ）'},
  fq: {build: faq, caption: '💬 FAQボット（自動応答のデモ）'},
  cd: {build: countdown, caption: '⏳ ご来店までのカウントダウン（ダミー）'},
};
export const html = (kind, state = null, now = Date.now()) => KINDS[kind].build(state, now);
