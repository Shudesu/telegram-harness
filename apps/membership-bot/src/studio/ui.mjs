// t78u design system for every HTML widget (Bot API 10.4 sendWidget) and the Mini App.
// One palette, one radius, one spacing scale. Colours follow the chat theme first
// (--tg-theme-*), and fall back to light-dark() so a widget previewed outside Telegram still
// renders correctly in both schemes. Widgets run in QuickJS with no network, no form controls,
// no scrolling and a 600 px height cap (https://core.telegram.org/bots/widgets), so every screen
// is a fixed-height card built from buttons only.

// Brand gradient and accent, shared with the profile photo and the Mini App.
export const BRAND = {a: '#5b4bff', b: '#b14bff', c: '#ff5ca8'};

export const CSS = `:root{color-scheme:light dark;--bg:var(--tg-theme-bg-color,light-dark(#fff,#16161d));--tx:var(--tg-theme-text-color,light-dark(#15151a,#f1f1f6));--ht:var(--tg-theme-hint-color,light-dark(#7d7d8c,#9a9aab));--s2:var(--tg-theme-secondary-bg-color,light-dark(#f1f1f7,#23232d));--bt:var(--tg-theme-button-color,#5b4bff);--bx:var(--tg-theme-button-text-color,#fff);--ok:#1fb57a;--ng:#ef4b6c;--gr:linear-gradient(135deg,#5b4bff,#b14bff 55%,#ff5ca8)}
*{box-sizing:border-box}body{margin:0;font:14px/1.4 system-ui,sans-serif;color:var(--tx);background:var(--bg)}
.hd{display:flex;align-items:center;gap:10px;padding:11px 12px;color:#fff;background:var(--gr)}.hd .ic{width:34px;height:34px;border-radius:10px;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;font-size:18px}.hd b{display:block;font-size:15px}.hd span{font-size:11px;opacity:.9}.hd .ch{margin-left:auto;font-size:11px;padding:3px 8px;border-radius:99px;background:rgba(255,255,255,.22)}
.w{padding:10px 12px 12px}.t{font-size:11px;color:var(--ht);margin:8px 2px 5px;letter-spacing:.02em}
.g{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.g2{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
button{border:0;border-radius:10px;padding:9px 4px;font:inherit;font-size:13px;background:var(--s2);color:var(--tx)}button.on{background:var(--bt);color:var(--bx)}button:disabled{opacity:.45}
.cta{display:block;width:100%;margin-top:10px;padding:11px;font-weight:600;color:#fff;background:var(--gr)}
.cd{background:var(--s2);border-radius:12px;padding:10px}.row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.pg{height:4px;border-radius:2px;background:var(--s2);margin-bottom:8px}.pg i{display:block;height:4px;border-radius:2px;background:var(--gr)}
.m{font-size:11px;color:var(--ht);text-align:center;margin-top:6px}.big{font-size:22px;font-weight:700}.mu{color:var(--ht);font-size:12px}`;

// Tiny runtime every widget starts with: $ / el / haptics / chat_data / guarded request.
// `q(data, ok)` sends one TelegramWidget.request and shows its progress in #x; `cd` mirrors the
// message's chat_data, which only the bot can change.
export const LIB = `var W=window.TelegramWidget,cd=null,busy=0;function $(i){return document.getElementById(i)}
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function hp(k){try{k?W.HapticFeedback.notificationOccurred(k):W.HapticFeedback.selectionChanged()}catch(e){}}
function rd(){try{cd=JSON.parse(W&&W.chatData)}catch(e){cd=null}}function msg(t){var x=$('x');if(x)x.textContent=t}
function bt(t,c,f){var b=el('button',c,t);b.onclick=function(){hp();f()};return b}
function q(d,ok){if(!W){msg('Telegramアプリ内で押してください');return}if(busy)return;busy=1;msg('送信中…');W.request(d).then(function(r){busy=0;msg('');var v=null;try{v=JSON.parse(r.result)}catch(e){}if(v&&v.e){msg(v.e);hp('error');return}if(ok)ok(v||{})},function(e){busy=0;msg('送れませんでした（'+(e&&e.code)+'）')})}
function yen(n){return '¥'+String(n).replace(/\\B(?=(\\d{3})+$)/g,',')}`;

// Builds a complete widget: header (icon, title, subtitle, chip) + #m body + #x status line.
// `js` must define R() (redraw from local state + cd); it is called on start and on every
// chatDataChanged, so a widget re-created by the app redraws from its state.
export function widget({icon, title, sub = '', chip = '', css = '', js}) {
  return `<style>${CSS}${css}</style><div class=hd><div class=ic>${icon}</div><div><b>${title}</b><span id=s>${sub}</span></div>${chip ? `<div class=ch id=c>${chip}</div>` : '<div class=ch id=c hidden></div>'}</div><div class=w id=m></div><div class=m id=x></div><script>${LIB}
${js}
if(W){W.onEvent('chatDataChanged',function(){rd();R()});W.ready()}rd();R();</script>`;
}
