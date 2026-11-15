// t79u Mini App: the dedicated "💳 決済・会員" entry. Plan → Stars invoice (openInvoice) → done →
// membership card. Served by this Worker at /app/ (the old carousel on the demo Worker is untouched).
//
// Money safety: the Stars invoice is only created when PAY_LIVE === "1" (on in production since t80u,
// 2026-11-11, owner-approved), always for the registered SKU app-<plan> at its registered price.
// Otherwise every checkout is a TEST invoice drawn by the page itself: nothing is created at
// Telegram, nothing can be paid, nothing is charged. External providers (Stripe / KOMOJU / bank
// transfer) are shown as 準備中 unless their keys are configured.
//
// v0.3.3 (P0): initData is checked by the shared verifier (../membership/webapp.mjs, 1 hour, at most
// 300 s in the future), the page is served with a per-response CSP nonce, and the page has a home
// screen, bottom tabs, a bottom sheet, the Telegram BackButton / SettingsButton and theme following.
// /app/api/lock* is reserved for the opt-in app lock and answers 501 (../membership/applock.mjs).
//
// v0.3.4 (P1): with APP_LOCK=1 those routes work, and /app/api/request takes a cancellation or
// refund request (a support ticket) behind the member's own lock, if they turned one on. With
// APP_LOCK unset nothing of this exists: the routes answer as in v0.3.3 and the page is unchanged.
import {randomBytes} from 'node:crypto';
import {providerStatus} from '../membership/providers/index.mjs';
import {verifyInitData, newNonce, pageResponse, apiJson, TELEGRAM_SDK} from '../membership/webapp.mjs';
import {isAppLockPath, appLockOn, appLockAvailable} from '../membership/applock.mjs';
import {CSS as WIDGET_CSS} from './ui.mjs';
import {memberNo as memberNoOf} from './flow.mjs';
import {APP_PLANS, SALON, planById, billingLabel, PERIOD_DAYS} from './plans.mjs';
import {TOKUSHO, TERMS_POINTS} from './legal.mjs';
export {APP_PLANS};
const untilOf = ms => { const d = new Date(ms + 9 * 3600000); return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };

const json = apiJson;
const providers = env => providerStatus(env).filter(p => p.id !== 'telegram_stars').map(p => ({id: p.id, label: p.label, ready: p.configured}));
export const payLive = env => env?.PAY_LIVE === '1';

// Routes under /app/. Returns null for anything else.
export async function appFetch(request, env, {now = Date.now()} = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/app')) return null;
  if (request.method === 'GET' && (url.pathname === '/app/' || url.pathname === '/app')) {
    const nonce = newNonce();
    return pageResponse(appHtml(nonce), nonce, {cache: 'no-cache'});
  }
  // The opt-in app lock (APP_LOCK=1 only; otherwise nothing is read or written).
  if (isAppLockPath(url.pathname) || (url.pathname === '/app/api/request' && appLockOn(env))) {
    if (!appLockOn(env)) return json({error: 'app_lock_not_available'}, 501);
    return lockFetch(request, env, url, now);
  }
  const m = request.method === 'POST' && /^\/app\/api\/(state|checkout|complete)$/.exec(url.pathname);
  if (!m) return new Response('not_found', {status: 404});
  let body; try { body = await request.json(); } catch { return json({error: 'bad_request'}, 400); }
  const who = await verifyInitData(body?.initData, env.BOT_TOKEN, {now});
  if (!who) return json({error: 'unauthorized'}, 401);
  const user = who.user;
  const chat = env.CHAT.getByName(`chat:${user.id}`);
  if (m[1] === 'state') {
    // Live: the membership service's entitlement is the truth; TEST: the record the demo wrote.
    let member;
    if (payLive(env) && env.MEMBERSHIP === '1') {
      const e = await env.CHAT.getByName(`membership:${env.TENANT_ID ?? 'main'}`).membership('app_member', {userId: user.id});
      member = e ? {no: memberNoOf(user.id), pl: planById(e.planId)?.name ?? e.title, until: e.expiresAt ? untilOf(e.expiresAt) : '無期限', renew: e.autoRenew === true, links: e.links ?? [], live: true} : null;
    } else member = await chat.studioApp('member', null);
    return json({user: {first_name: user.first_name}, salon: SALON, plans: APP_PLANS.map(p => ({...p, bill: billingLabel(p)})), providers: providers(env), live: payLive(env), member,
      legal: {terms: TERMS_POINTS, tokusho: TOKUSHO}, ...(appLockAvailable(env) ? {lock: {available: true}} : {})});
  }
  const plan = APP_PLANS.find(p => p.id === body.plan);
  if (!plan) return json({error: 'unknown_plan'}, 400);
  if (m[1] === 'checkout') {
    if (!payLive(env)) return json({mode: 'demo', invoice: {id: `TEST-I-${randomBytes(3).toString('hex').toUpperCase()}`, title: `${plan.name}プラン（${PERIOD_DAYS}日）`, stars: plan.stars}});
    // Live only when explicitly enabled, and only through the membership service's own checkout:
    // it creates the order (so pre_checkout / successful_payment resolve it and grant the
    // membership) and its owner rules gate the invoice. The SKU id is `app-<plan>`, registered by
    // the owner with /admin/membership/plan_set; without it nothing is created.
    if (env.MEMBERSHIP !== '1') return json({error: 'invoice_unavailable'}, 503);
    const r = await env.CHAT.getByName(`membership:${env.TENANT_ID ?? 'main'}`).membership('app_checkout', {userId: user.id, skuId: `app-${plan.id}`});
    if (r?.status === 'created' && typeof r.url === 'string') return json({mode: 'live', link: r.url});
    return json({error: r?.status === 'pending_approval' ? 'pending_approval' : 'invoice_unavailable'}, 409);
  }
  // complete: only the TEST path records a membership here (a live payment is recorded from the
  // successful_payment update by the membership service, never from the page's word).
  if (payLive(env)) return json({error: 'live_payment_is_confirmed_by_telegram'}, 409);
  if (!/^TEST-I-[0-9A-F]{6}$/.test(body.invoice ?? '')) return json({error: 'bad_invoice'}, 400);
  const member = await chat.studioApp('test_join', {plan: plan.name, invoice: body.invoice});
  return json({member});
}

// ---------------------------------------------------------------------------------------------
// App lock routes (APP_LOCK=1). Every call carries the Mini App initData; the user is the one it
// was signed for, never a field of the body. The decision is made by the membership object.
const LOCK_OPS = {
  'POST /app/api/lock': 'state',
  'POST /app/api/lock/setup': 'setup',
  'POST /app/api/lock/confirm-recovery': 'confirmRecovery',
  'POST /app/api/lock/unlock': 'unlock',
  'POST /app/api/lock/bio/enroll': 'bioEnroll',
  'POST /app/api/lock/bio/unlock': 'bioUnlock',
  'POST /app/api/lock/recover': 'recover',
  'DELETE /app/api/lock/rescue': 'rescueCancel',
  'POST /app/api/lock/disable': 'disable',
};
const LOCK_FIELDS = ['passcode', 'stepUp', 'last4', 'token', 'type', 'label', 'code'];
const statusOf = e => e === 'unlock_required' ? 403 : /locked/.test(e) ? 423 : e === 'rate_limited' ? 429 : 400;
async function lockFetch(request, env, url, now) {
  const route = `${request.method} ${url.pathname}`;
  const bio = request.method === 'DELETE' && /^\/app\/api\/lock\/bio\/([0-9a-f]{12})$/.exec(url.pathname);
  const op = LOCK_OPS[route] ?? (bio ? 'bioDelete' : url.pathname === '/app/api/request' && request.method === 'POST' ? 'request' : null);
  // The reset is started only from the private chat (/applock_reset): its reply is the notice.
  if (route === 'POST /app/api/lock/rescue') return json({error: 'use_chat_command', command: '/applock_reset'}, 409);
  if (!op) return new Response('not_found', {status: 404});
  if (!appLockAvailable(env)) return json({error: 'app_lock_not_configured'}, 503);
  let body; try { body = await request.json(); } catch { return json({error: 'bad_request'}, 400); }
  const who = await verifyInitData(body?.initData, env.BOT_TOKEN, {now});
  if (!who) return json({error: 'unauthorized'}, 401);
  const mo = env.CHAT.getByName(`membership:${env.TENANT_ID ?? 'main'}`);
  if (op === 'request') {
    const r = await mo.membership('app_request', {userId: who.user.id, kind: body.kind, text: typeof body.text === 'string' ? body.text : '', stepUp: body.stepUp});
    return r?.status === 'created' ? json({ok: true, id: r.id}) : json({error: r?.status ?? 'failed'}, statusOf(r?.status ?? ''));
  }
  const args = {};
  for (const k of LOCK_FIELDS) if (typeof body[k] === 'string' && body[k].length <= 200) args[k] = body[k];
  if (bio) args.id = bio[1];
  const r = await mo.membership('app_lock', op, who.user.id, args);
  return r?.error ? json(r, statusOf(r.error)) : json(r ?? {});
}

// ---------------------------------------------------------------------------------------------
// The page. Layout: home (member status card, four round shortcuts, swipeable notices) / plans /
// member card / more, switched by a bottom tab bar; terms, the TEST invoice and the completion
// screen open on top of a tab with the Telegram BackButton; short choices open in a bottom sheet.
// Every Telegram API is optional: each call is version-checked and wrapped, so an old client or a
// plain browser still gets a working page (in-page back and bottom buttons instead).
const PAGE_CSS = `${WIDGET_CSS}
:root{--sb:max(env(safe-area-inset-bottom),var(--tg-safe-area-inset-bottom,0px));--lk:var(--tg-theme-link-color,var(--bt));--ac:var(--tg-theme-accent-text-color,var(--bt))}
html,body{background:var(--tg-theme-secondary-bg-color,var(--s2))}body{padding-bottom:calc(84px + var(--sb));font-size:15px}body.sub{padding-bottom:calc(24px + var(--sb))}
.hero{padding:22px 18px 26px;color:#fff;background:var(--gr);border-radius:0 0 22px 22px}.hero h1{margin:0;font-size:22px}.hero p{margin:4px 0 0;opacity:.9;font-size:13px}
.top{padding:calc(14px + var(--tg-content-safe-area-inset-top,0px)) 16px 0}.top h1{margin:0;font-size:22px}.top p{margin:2px 0 0;color:var(--ht);font-size:13px}
.stc{margin:12px 14px 0;padding:16px;border-radius:20px;color:#fff;background:var(--gr);box-shadow:0 10px 26px rgba(91,75,255,.28)}.stc .row{align-items:flex-start}.stc .lb{font-size:12px;opacity:.88}
.stc .big{margin-top:4px;font-size:23px;font-weight:800}.stc .big small{font-size:12px;font-weight:600;opacity:.9}.stc .sb{margin-top:2px;font-size:13px;opacity:.92}.stc .no{margin-top:10px;font:12px/1.4 ui-monospace,monospace;opacity:.92;letter-spacing:.04em}
.eye{padding:5px 10px;border-radius:99px;background:rgba(255,255,255,.22);color:#fff;font-size:12px}
.acts{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:18px 8px 6px}.ac{display:flex;flex-direction:column;align-items:center;gap:6px;padding:0;background:none;color:var(--tx);font-size:12px}
.ac i{display:flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:var(--bg);font-style:normal;font-size:23px;box-shadow:0 2px 10px rgba(0,0,0,.06)}.ac:active i{transform:scale(.94)}
.bn{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;padding:2px 14px 8px;scrollbar-width:none}.bn::-webkit-scrollbar{display:none}
.bn>div{flex:0 0 84%;scroll-snap-align:center;padding:14px 16px;border-radius:16px;background:var(--bg)}.bn b{display:block;font-size:14px}.bn span{display:block;margin-top:3px;font-size:12px;line-height:1.5;color:var(--ht)}
.sec{margin:16px 14px 6px;font-size:12px;color:var(--ht);letter-spacing:.04em}
.pc{display:block;width:calc(100% - 28px);margin:8px 14px;padding:14px;text-align:left;border-radius:16px;background:var(--bg);border:2px solid transparent;color:var(--tx);font-size:15px}
button.pc.on{background:var(--bg);color:var(--tx);border-color:var(--bt);box-shadow:0 6px 18px color-mix(in srgb,var(--bt) 25%,transparent)}.pc .top2{display:flex;align-items:center;gap:8px}.pc b{font-size:17px}.pc .pr{margin-left:auto;font-weight:700}.pc ul{margin:8px 0 0;padding-left:18px;color:var(--ht);font-size:13px}
.tg{font-size:11px;padding:2px 7px;border-radius:99px;background:var(--gr);color:#fff}
.pm{display:flex;align-items:center;gap:10px;margin:0 14px;padding:12px 14px;background:var(--bg);border-bottom:1px solid var(--s2)}.pm:first-of-type{border-radius:14px 14px 0 0}.pm:last-child{border-radius:0 0 14px 14px;border-bottom:0}
.pm .st{margin-left:auto;font-size:12px;color:var(--ht)}.pm .st.ok{color:var(--ok)}.pm.off{opacity:.55}
.lst{margin:0 14px;border-radius:14px;overflow:hidden;background:var(--bg)}.lr{display:flex;align-items:center;gap:12px;width:100%;padding:14px;border-radius:0;background:none;border-bottom:1px solid var(--s2);text-align:left;font-size:15px;color:var(--tx)}.lr:last-child{border-bottom:0}.lr .ch{margin-left:auto;color:var(--ht)}
.inv{margin:14px;padding:18px;border-radius:18px;background:var(--bg);text-align:center}.inv .amt{font-size:34px;font-weight:800;margin:6px 0}
.note{margin:10px 14px;padding:10px 12px;border-radius:12px;font-size:12px;background:var(--bg);color:var(--ht)}
.card{margin:14px;padding:18px;border-radius:20px;color:#fff;background:var(--gr);display:flex;gap:14px;align-items:center;box-shadow:0 10px 30px rgba(91,75,255,.3)}.card .q{background:#fff;border-radius:10px;padding:6px}.card b{font-size:18px}.card .n{font:12px/1.6 ui-monospace,monospace;opacity:.92}
.emp{margin:24px 14px;padding:26px 18px;border-radius:18px;background:var(--bg);text-align:center}.emp i{display:block;font-style:normal;font-size:40px}.emp b{display:block;margin-top:6px;font-size:17px}.emp span{display:block;margin-top:4px;color:var(--ht);font-size:13px}
.ok-ic{width:64px;height:64px;margin:6px auto;border-radius:50%;background:var(--ok);color:#fff;font-size:34px;display:flex;align-items:center;justify-content:center;animation:pop .35s ease-out}@keyframes pop{from{transform:scale(.4);opacity:0}}
.sk{height:96px;margin:10px 14px;border-radius:16px;background:linear-gradient(90deg,var(--bg),var(--s2),var(--bg));background-size:200% 100%;animation:shm 1.2s infinite}@keyframes shm{to{background-position:-200% 0}}
.err{margin:12px 14px;padding:12px;border-radius:12px;background:color-mix(in srgb,var(--ng) 14%,var(--bg));color:var(--ng);font-size:13px}.err button{margin-top:8px;background:var(--ng);color:#fff;padding:8px 14px}
.pc .ds{margin:6px 0 0;font-size:13px;line-height:1.5}.pc .bl{display:inline-block;margin-top:6px;font-size:11px;padding:2px 8px;border-radius:99px;background:var(--s2);color:var(--ht)}
.lk{background:none;border:0;padding:0;color:var(--lk);text-decoration:underline;font-size:12px}
.lg{margin:10px 14px;padding:14px;border-radius:14px;background:var(--bg);font-size:13px;line-height:1.6}.lg h3{margin:0 0 6px;font-size:14px}.lg ul{margin:0 0 6px;padding-left:18px}.lg dt{font-weight:700;margin-top:6px}.lg dd{margin:0;color:var(--ht)}
.bk{display:block;margin:10px 14px 0;padding:4px 0;background:none;color:var(--lk);font-size:15px}
.tabs{position:fixed;left:0;right:0;bottom:0;z-index:5;display:flex;padding:6px 4px calc(6px + var(--sb));background:var(--bg);border-top:1px solid var(--s2)}body.sub .tabs{display:none}
.tabs button{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px 0;background:none;color:var(--ht);font-size:11px}.tabs i{font-style:normal;font-size:20px;filter:grayscale(1);opacity:.7}
.tabs button[aria-current=page]{color:var(--ac);font-weight:600}.tabs button[aria-current=page] i{filter:none;opacity:1}
.sh{position:fixed;inset:0;z-index:20}.sh[hidden]{display:none}.shb{position:absolute;inset:0;background:rgba(0,0,0,.45);opacity:0;transition:opacity .25s}
.shp{position:absolute;left:0;right:0;bottom:0;max-height:86vh;overflow:auto;overscroll-behavior:contain;padding:10px 20px calc(20px + var(--sb));border-radius:22px 22px 0 0;background:var(--bg);text-align:center;transform:translateY(100%);transition:transform .25s ease-out}
.sh.on .shb{opacity:1}.sh.on .shp{transform:none}.shg{width:38px;height:5px;margin:0 auto 6px;border-radius:3px;background:var(--s2)}
.shx{position:absolute;top:10px;right:12px;width:32px;height:32px;padding:0;border-radius:50%;font-size:15px;color:var(--ht)}
.shi{margin:10px 0 4px;font-size:46px}.shp h2{margin:4px 0 6px;font-size:19px}.shp p{margin:0 auto 8px;max-width:30em;color:var(--ht);font-size:14px;line-height:1.6}.shp .cta{padding:13px;border-radius:12px;font-size:15px}
.fb{display:none}.nomain .fb{display:block;width:calc(100% - 28px);margin:12px 14px}
.pin{padding:calc(18px + var(--tg-content-safe-area-inset-top,0px)) 16px 0;text-align:center}.pin .pi{font-size:34px}.pin h2{margin:6px 0 14px;font-size:18px}
.dots{display:flex;justify-content:center;gap:14px;margin:6px 0}.dots i{width:14px;height:14px;border-radius:50%;border:2px solid var(--ht)}.dots i.on{background:var(--bt);border-color:var(--bt)}
.pmsg{min-height:2.6em;margin:8px 10px;color:var(--ng);font-size:13px;line-height:1.4}
.kp{display:grid;grid-template-columns:repeat(3,72px);justify-content:center;gap:12px 22px;margin:6px 0 14px}.kp button{width:72px;height:72px;border-radius:50%;background:var(--bg);font-size:26px;font-weight:500}.kp button:active{background:var(--s2)}
.rcb{display:flex;align-items:center;gap:8px;margin:12px 14px;padding:14px;border-radius:14px;background:var(--bg)}.rcb code{flex:1;font:15px/1.5 ui-monospace,monospace;letter-spacing:.04em;word-break:break-all;user-select:all}.rcb button{padding:8px 12px}
.in{display:block;width:100%;margin-top:6px;padding:10px 12px;border:1px solid var(--s2);border-radius:10px;background:var(--s2);color:var(--tx);font:16px/1.4 ui-monospace,monospace}textarea.in{font:15px/1.5 system-ui,sans-serif;resize:vertical}
.lst .lr small{font-size:11px}.lst div.lr{cursor:default}
@media (prefers-reduced-motion:reduce){.shp,.shb,.ok-ic,.sk{transition:none;animation:none}}`;

const PAGE_JS = `(function(){'use strict';var T=window.Telegram&&Telegram.WebApp,S={plan:1,data:null,inv:null,tab:'home',sub:null,fresh:0,hide:true,busy:0},A=document.getElementById('a'),TB=document.getElementById('tabs'),SH=document.getElementById('sh'),SP=document.getElementById('shp'),SC=document.getElementById('shc');
function ver(x){try{return !!(T&&T.isVersionAtLeast(x))}catch(e){return false}}
var NB=!!(T&&T.BackButton&&ver('6.1'));
function hp(k){try{var H=T.HapticFeedback;k=='sel'?H.selectionChanged():k=='tap'?H.impactOccurred('light'):H.notificationOccurred(k)}catch(e){}}
function api(p,b){b=b||{};b.initData=T&&T.initData||'';return fetch('/app/api/'+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw Error(j.error||r.status);return j})})}
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function $(i){return document.getElementById(i)}
// MainButton / SecondaryButton: an empty text hides the button (setParams refuses an empty text).
function bb(B,t,f,extra){try{B.offClick(B._cb||function(){});B._cb=null;if(!t){B.hide();return}B._cb=function(){hp('tap');f()};B.onClick(B._cb);var o={text:t,is_visible:true};for(var k in extra)o[k]=extra[k];B.setParams(o)}catch(e){}}
// While the bottom sheet is open the native buttons (which the overlay cannot cover) are hidden;
// the screen's buttons are remembered and put back when it closes.
var LM=['',null],LS=['',null],shOn=0;
function main(t,f){LM=[t,f];if(shOn)t='';var M=T&&T.MainButton;if(!M){fb('m',t,f);return}bb(M,t,f,{is_active:true,has_shine_effect:true});try{M.hideProgress()}catch(e){}}
function sec(t,f){LS=[t,f];if(shOn)t='';var B=T&&T.SecondaryButton;if(!B||!ver('7.10')){fb('s',t,f);return}bb(B,t,f,{position:'bottom'})}
function fb(k,t,f){var b=$('fb'+k);if(!b)return;b.textContent=t||'';b.style.display=t?'block':'none';b.onclick=f}
function busy(on){var M=T&&T.MainButton;try{if(M)on?M.showProgress(false):M.hideProgress()}catch(e){}}
function err(m,retry){var d=document.createElement('div');d.className='err';d.setAttribute('role','alert');d.textContent='⚠️ '+m;if(retry){var b=document.createElement('button');b.textContent='もう一度';b.onclick=function(){d.remove();retry()};d.appendChild(document.createElement('br'));d.appendChild(b)}A.prepend(d);hp('error')}
function msgOf(e){var c=String(e&&e.message||e);return c=='unauthorized'?'有効期限が切れました。Telegram から開き直してください':c=='invoice_unavailable'?'このプランは現在お申し込みできません':c=='pending_approval'?'確認中です。承認後にチャットへご案内します':'通信できませんでした（'+c+'）'}
function qr(n){var s='<svg width=84 height=84 viewBox="0 0 21 21" shape-rendering=crispEdges aria-hidden=true>',x=0;for(var i=0;i<n.length;i++)x=(x*31+n.charCodeAt(i))%2147483647;function f(a,b){s+='<rect x='+a+' y='+b+' width=7 height=7 /><rect x='+(a+1)+' y='+(b+1)+' width=5 height=5 fill=#fff /><rect x='+(a+2)+' y='+(b+2)+' width=3 height=3 />'}for(var r=0;r<21;r++)for(var c=0;c<21;c++){if((r<8&&c<8)||(r<8&&c>12)||(r>12&&c<8))continue;x=(x*1103515245+12345)%2147483648;if(x%3==0)s+='<rect x='+c+' y='+r+' width=1 height=1 />'}f(0,0);f(14,0);f(0,14);return s+'</svg>'}
function hero(t,p){return '<div class=hero><h1>'+t+'</h1><p>'+p+'</p></div>'}
function back(){return NB?'':'<button class=bk id=bk>‹ 戻る</button>'}
// ---- Telegram-side storage (CloudStorage, 6.9+). Only "already seen" flags; never anything secret.
function cget(k,cb){try{if(!ver('6.9'))return cb(null);T.CloudStorage.getItem(k,function(e,v){cb(e?null:(v||null))})}catch(e){cb(null)}}
function cset(k,v){try{if(ver('6.9'))T.CloudStorage.setItem(k,v)}catch(e){}}
// ---- bottom sheet: backdrop, slides up, closes with ×, the backdrop, BackButton, Esc or a swipe down.
var shFn=null,y0=null,dy=0;
function sheet(o){SC.innerHTML=(o.icon?'<div class=shi aria-hidden=true>'+o.icon+'</div>':'')+'<h2 id=sht>'+esc(o.title)+'</h2><p>'+esc(o.text)+'</p>'+(o.btn?'<button class=cta id=sha>'+esc(o.btn)+'</button>':'');
var b=$('sha');shFn=o.fn||null;if(b)b.onclick=function(){var f=shFn;hp('tap');closeSheet();if(f)f()};
SH.hidden=false;shOn=1;main(LM[0],LM[1]);sec(LS[0],LS[1]);SP.style.transform='';requestAnimationFrame(function(){requestAnimationFrame(function(){SH.classList.add('on')})});
try{if(ver('7.7'))T.disableVerticalSwipes()}catch(e){}nav();hp('tap');setTimeout(function(){var x=$('shx');if(x)x.focus()},260)}
function closeSheet(){if(!shOn)return;shOn=0;main(LM[0],LM[1]);sec(LS[0],LS[1]);SH.classList.remove('on');SP.style.transform='';setTimeout(function(){if(!shOn)SH.hidden=true},260);try{if(ver('7.7'))T.enableVerticalSwipes()}catch(e){}nav()}
$('shx').onclick=function(){hp('sel');closeSheet()};SH.querySelector('.shb').onclick=function(){closeSheet()};
document.addEventListener('keydown',function(e){if(e.key=='Escape')goBack()});
SP.addEventListener('touchstart',function(e){y0=SP.scrollTop>0?null:e.touches[0].clientY;dy=0},{passive:true});
SP.addEventListener('touchmove',function(e){if(y0==null)return;dy=Math.max(0,e.touches[0].clientY-y0);SP.style.transition='none';SP.style.transform='translateY('+dy+'px)'},{passive:true});
SP.addEventListener('touchend',function(){if(y0==null)return;SP.style.transition='';y0=null;if(dy>90)closeSheet();else SP.style.transform=''});
function joinSheet(){sheet({icon:'⭐',title:'まだ会員ではありません',text:'プランを選んで Telegram Stars で登録すると、ここに会員証が表示されます。',btn:'プランを選ぶ',fn:function(){go('plans')}})}
function helpSheet(){sheet({icon:'💬',title:'お問い合わせ',text:'チャットで /paysupport と送ってください。お支払い・返金のご相談を受け付けます。運営からパスワードや認証コードを聞くことはありません。',btn:'チャットに戻る',fn:function(){if(T)T.close()}})}
// ---- navigation: BackButton is shown while a sub-screen or the sheet is open.
function nav(){var on=shOn||!!S.sub;if(NB){try{on?T.BackButton.show():T.BackButton.hide()}catch(e){}}document.body.classList.toggle('sub',!!S.sub);
TB.querySelectorAll('button').forEach(function(b){if(b.dataset.t==S.tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')})}
function goBack(){if(shOn){hp('sel');closeSheet();return}if(S.sub=='pin'){hp('sel');L.cb=null;L.pin1='';pinBack();return}if(S.sub=='rec'||S.sub=='rc'){hp('sel');L.code=null;L.rc=null;L.st=null;S.sub='lock';render();return}if(S.sub){hp('sel');S.sub=null;S.fresh=0;render()}}
function go(t){closeSheet();S.sub=null;S.fresh=0;if(S.tab!=t)hp('sel');S.tab=t;render();window.scrollTo(0,0);if(t=='card'&&S.data&&!S.data.member)joinSheet()}
function push(v){S.sub=v;render();window.scrollTo(0,0)}
function render(){if(!S.data)return;var v=S.sub||S.tab;({home:home,plans:plans,card:card,more:more,terms:terms,invoice:invoice,done:done,lock:lock,pin:pin,rc:rc,rec:rec,req:req})[v]();var b=$('bk');if(b)b.onclick=goBack;nav()}
// ---- screens
function act(id,ic,t){return '<button class=ac data-a='+id+'><i aria-hidden=true>'+ic+'</i>'+t+'</button>'}
var NEWS=[['⭐ Stars でかんたん登録','お支払いは Telegram の公式の支払い画面で完結します。'],['🔁 自動更新はいつでも停止','Telegram の 設定 → Telegram Stars → サブスクリプション から止められます。'],['💬 困ったときは /paysupport','チャットで送ると、運営がお返事します。']];
function home(){var d=S.data,m=d.member,h='<div class=top><h1>'+(d.user.first_name?esc(d.user.first_name)+' さん':'ようこそ')+'</h1><p>'+esc(d.salon)+'</p></div><div class=stc><div class=row><span class=lb>会員状態</span>'+(m?'<button class=eye id=eye aria-pressed='+(!S.hide)+'>'+(S.hide?'番号を表示':'番号を隠す')+'</button>':'')+'</div>';
h+=m?'<div class=big>⭐ '+esc(m.pl)+'会員'+(m.live?'':' <small>テスト</small>')+'</div><div class=sb>'+(m.renew?'次回更新 ':'有効期限 ')+esc(m.until)+'</div><div class=no>No. '+(S.hide?'TH-••••-••••':esc(m.no))+'</div>':'<div class=big>未登録</div><div class=sb>プランを選ぶと会員証が発行されます</div>';
h+='</div><nav class=acts aria-label=ショートカット>'+act('plans','⭐','プラン')+act('card','🪪','会員証')+act('terms','📄','規約')+act('help','💬','サポート')+'</nav><div class=sec>お知らせ</div><div class=bn>'+NEWS.map(function(n){return '<div><b>'+n[0]+'</b><span>'+n[1]+'</span></div>'}).join('')+'</div>';
A.innerHTML=h;var e=$('eye');if(e)e.onclick=function(){S.hide=!S.hide;hp('sel');render()};
A.querySelectorAll('.ac').forEach(function(b){b.onclick=function(){hp('tap');var a=b.dataset.a;a=='terms'?push('terms'):a=='help'?helpSheet():go(a)}});
m?main('',null):main('⭐ プランを選ぶ',function(){go('plans')});sec('',null)}
function plans(){var d=S.data,m=d.member,h='<div class=top><h1>プラン</h1><p>'+(m?'⭐ '+esc(m.pl)+'会員'+(m.live?'':'（テスト）'):'Telegram Stars で登録できます')+'</p></div>';
h+='<div class=sec>プラン</div>';d.plans.forEach(function(p,k){h+='<button class="pc'+(k==S.plan?' on':'')+'" data-k='+k+' aria-pressed='+(k==S.plan)+'><div class=top2><b>'+esc(p.name)+'</b>'+(p.tag?'<span class=tg>'+esc(p.tag)+'</span>':'')+'<span class=pr>⭐ '+p.stars+' <small>/30日</small></span></div><div class=ds>'+esc(p.desc)+'</div><span class=bl>'+(p.recurring?'🔁 ':'')+esc(p.bill)+'</span><ul>'+p.f.map(function(f){return '<li>'+esc(f)+'</li>'}).join('')+'</ul></button>'});
h+='<div class=sec>支払い方法</div><div><div class=pm>⭐ <b>Telegram Stars</b><span class="st ok">'+(d.live?'利用可':'テスト（実請求なし）')+'</span></div>';d.providers.forEach(function(p){h+='<div class="pm'+(p.ready?'':' off')+'">'+({stripe:'💳',komoju:'🏪',bank_gmo:'🏦'}[p.id]||'•')+' '+esc(p.label)+'<span class=st>'+(p.ready?'利用可':'準備中')+'</span></div>'});h+='</div>';
h+='<div class=note>デジタル会員権はTelegram規約によりStarsで販売します。カード等の外部決済は予約・店舗サービスのみ対象で、現在は準備中です。<br>自動更新はTelegramの設定からいつでも停止できます。お申し込みで<button class=lk id=tm>利用規約・特商法表記</button>に同意したものとみなします。お問い合わせはチャットで /paysupport</div>';
A.innerHTML=h;$('tm').onclick=function(){hp('sel');push('terms')};A.querySelectorAll('.pc').forEach(function(b){b.onclick=function(){if(S.busy)return;S.plan=+b.dataset.k;hp('sel');render()}});
var p=d.plans[S.plan];main('⭐ '+p.stars+' Stars で登録',checkout);sec('',null)}
function card(){var m=S.data.member;if(!m){A.innerHTML='<div class=top><h1>会員証</h1></div><div class=emp><i aria-hidden=true>🪪</i><b>会員証はまだありません</b><span>プランに登録すると、ここに表示されます。</span></div>';main('⭐ プランを選ぶ',function(){go('plans')});sec('',null);return}
A.innerHTML='<div class=top><h1>会員証</h1><p>'+(m.live?'有効な会員資格です':'チャットの会員証ウィジェットにも反映されます')+'</p></div>'+cardHtml(m);links(m);main('',null);sec('',null)}
function cardHtml(m){return '<div class=card><div class=q>'+qr(m.no)+'</div><div><div class=n>TELEHARNESS MEMBER</div><b>⭐ '+esc(m.pl)+'会員</b><div class=n>No. '+esc(m.no)+'</div><div class=n>'+(m.renew?'次回更新 ':'有効期限 ')+esc(m.until)+'</div></div></div><div class=note>'+(m.live?'お支払いは Telegram Stars で処理されました。'+(m.links&&m.links.length?'':'会員グループは準備中です（開設しだいチャットでご案内します）。')+(m.renew?'自動更新は Telegram の 設定 → Telegram Stars → サブスクリプション から停止できます。':'')+'返金・お問い合わせはチャットで /paysupport':'この会員証はデモです。実在の会員資格・入会はありません。')+'</div>'}
function links(m){(m.links||[]).forEach(function(u,i){if(String(u).indexOf('https://t.me/')!==0)return;var b=document.createElement('button');b.className='pc';b.textContent='👥 会員グループ'+(i+1)+'に参加申請';b.onclick=function(){hp('tap');try{T.openTelegramLink(u)}catch(e){location.href=u}};A.appendChild(b)})}
function more(){A.innerHTML='<div class=top><h1>その他</h1></div><div class=sec>サポート</div><div class=lst><button class=lr id=m1><span>📄</span>利用規約・特商法表記<span class=ch>›</span></button><button class=lr id=m2><span>💬</span>お問い合わせ（/paysupport）<span class=ch>›</span></button><button class=lr id=m3><span>↩️</span>チャットに戻る<span class=ch>›</span></button></div>'+(S.data.lock?'<div class=sec>安全</div><div class=lst><button class=lr id=m4><span>🔐</span>アプリロック<span class=ch>›</span></button><button class=lr id=m5><span>📝</span>解約・返金の申請<span class=ch>›</span></button></div>':'')+'<div class=note>運営からパスワードや認証コードを聞くことはありません。お支払いは Telegram の支払い画面でのみ行われます。</div>';
$('m1').onclick=function(){hp('tap');push('terms')};$('m2').onclick=function(){helpSheet()};$('m3').onclick=function(){hp('tap');if(T)T.close()};if(S.data.lock){$('m4').onclick=function(){hp('tap');L.st=null;push('lock')};$('m5').onclick=function(){hp('tap');L.st=null;push('req')}}main('',null);sec('',null)}
function terms(){var L=S.data.legal;A.innerHTML=back()+hero('📄 利用規約','特定商取引法に基づく表記')+'<div class=lg><h3>利用規約（要約）</h3><ul>'+L.terms.map(function(t){return '<li>'+esc(t)+'</li>'}).join('')+'</ul></div><div class=lg><h3>特定商取引法に基づく表記</h3><dl>'+L.tokusho.map(function(r){return '<dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd>'}).join('')+'</dl></div>';main('',null);sec('',null)}
function invoice(){var i=S.inv;A.innerHTML=back()+hero('🧾 お支払い確認','TEST 請求書（実際のStarsは動きません）')+'<div class=inv><div class=mu>'+esc(i.title)+'</div><div class=amt>⭐ '+i.stars+'</div><div class=mu>請求番号 '+esc(i.id)+'</div></div><div class=note>本番では Telegram 公式の支払い画面（openInvoice）が開きます。いまはデモのため、この画面でテスト完了まで進みます。</div>';
main('テスト支払いを完了する',pay);sec('キャンセル',function(){hp('warning');goBack()})}
function done(){var m=S.data.member,f=S.fresh;if(!m){S.sub=null;return render()}A.innerHTML=back()+hero(f?'登録完了':'🪪 会員証',f?(m.live?'お支払いが完了しました。会員資格が有効になりました':'テスト決済が完了しました（実請求なし）'):'')+(f?'<div class=ok-ic aria-hidden=true>✓</div>':'')+cardHtml(m);links(m);
main('チャットに戻る',function(){T&&T.close()});sec('ホームへ',function(){go('home')});if(f)homeOffer()}
// ---- money flow (unchanged rules: the server decides; a live payment is confirmed by Telegram)
function key(m){return m?m.pl+'|'+m.until+'|'+(m.renew?1:0):''}
function checkout(){if(S.busy)return;var k=S.plan,p=S.data.plans[k],before=key(S.data.member);S.busy=1;busy(true);api('checkout',{plan:p.id}).then(function(r){S.busy=0;busy(false);if(r.mode=='live'){T.openInvoice(r.link,function(st){if(st=='paid'){hp('success');waitMember(0,before)}else if(st=='failed'){err('支払いに失敗しました',checkout)}else if(st=='cancelled'){hp('warning')}})}else{S.inv=r.invoice;S.inv.plan=k;push('invoice')}},function(e){S.busy=0;busy(false);err(msgOf(e),checkout)})}
function pay(){if(S.busy)return;var p=S.data.plans[S.inv.plan];S.busy=1;busy(true);api('complete',{plan:p.id,invoice:S.inv.id}).then(function(r){S.busy=0;busy(false);S.data.member=r.member;hp('success');finish()},function(e){S.busy=0;busy(false);err(msgOf(e),pay)})}
function finish(){S.tab='card';S.fresh=1;push('done')}
function loading(){A.innerHTML='<div class=top><h1>💳 決済・会員</h1><p>読み込み中…</p></div><div class=sk></div><div class=sk></div><div class=sk></div>';main('',null);sec('',null)}
function waitMember(n,before){loading();api('state').then(function(d){S.data=d;if(d.member&&key(d.member)!=before)finish();else if(n<6)setTimeout(function(){waitMember(n+1,before)},1500);else{S.tab='plans';S.sub=null;render();err('支払いを受け付けました。会員反映まで少しお待ちください')}},function(e){err(msgOf(e),function(){waitMember(0,before)})})}
function refresh(){loading();api('state').then(function(d){S.data=d;if(S.want){d.plans.forEach(function(p,k){if(p.id==S.want){S.plan=k;S.tab='plans'}});S.want=null}render();notice()},function(e){A.innerHTML='<div class=top><h1>💳 決済・会員</h1></div>';err(msgOf(e),refresh)})}
// ---- once-only offers (flags in CloudStorage, so they are not shown again on another device)
function notice(){cget('th_notice_v1',function(v){if(v||shOn||S.sub)return;cset('th_notice_v1','1');sheet({icon:'✨',title:'会員ページが新しくなりました',text:'下のタブで ホーム・プラン・会員証 を切り替えられます。お支払いはこれまでどおり Telegram の支払い画面で行います。',btn:'はじめる'})})}
function homeOffer(){if(!ver('8.0'))return;cget('th_home_v1',function(v){if(v)return;try{T.checkHomeScreenStatus(function(st){if(st!='missed')return;cset('th_home_v1','1');sheet({icon:'📲',title:'ホーム画面に追加しますか',text:'スマホのホーム画面から、会員証をすぐ開けるようになります。',btn:'追加する',fn:function(){try{T.addToHomeScreen()}catch(e){}}})})}catch(e){}})}
// ---- v0.3.4 app lock (shown only when the server says lock.available). Every decision is the
// server's; this page only collects the passcode / code and keeps a 5-minute unlock in memory.
var L={seq:0,subm:0,st:null,su:null,suExp:0,pin:'',pin1:'',mode:null,msg:'',ret:null,cb:null,code:null,rc:null,kind:'cancel'},BM=null;
function lapi(p,b,m){b=b||{};b.initData=T&&T.initData||'';return fetch('/app/api/'+p,{method:m||'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){if(r.status==401&&j.error=='unauthorized')throw Error('unauthorized');if(r.status>=500)throw Error(j.error||r.status);if(j.error=='unlock_required')L.su=null;return j})})}
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}
function bmInit(cb){if(BM!==null)return cb(BM);try{if(!ver('7.2'))throw 0;var B=T.BiometricManager;if(B.isInited){BM=B.isBiometricAvailable?B:false;return cb(BM)}B.init(function(){BM=B.isBiometricAvailable?B:false;cb(BM)})}catch(e){BM=false;cb(false)}}
function bmName(){return BM&&BM.biometricType=='face'?'Face ID・顔認証':'指紋認証'}
function devName(){var p=T&&T.platform||'';return p=='ios'?'iOS 端末':p=='android'?'Android 端末':p=='macos'?'Mac':p=='tdesktop'?'PC':'端末'}
function jt(ms){var d=new Date(ms);return (d.getMonth()+1)+'/'+d.getDate()+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)}
function setSu(j){L.su=j.stepUp;L.suExp=j.stepUpExpiresAt||0}
function lmsg(j){var e=j&&j.error;return e=='wrong_passcode'?(j.remaining>0?'パスコードが違います（あと'+j.remaining+'回まちがえると、しばらく入力できなくなります）':'パスコードが違います'+(j.lockedUntil?'。'+jt(j.lockedUntil)+' まで入力できません':'')):e=='locked'?jt(j.lockedUntil)+' まで入力できません':e=='locked_hard'?'まちがいが続いたため、パスコードでは開けません。リカバリーコードを使ってください':e=='passcode_too_simple'?'同じ数字・連番・くり返しは使えません':e=='passcode_format'?'数字6桁で入力してください':e=='wrong_recovery_code'?'リカバリーコードが違います':e=='recovery_locked'?'リカバリーコードは '+jt(j.recoveryLockedUntil)+' まで入力できません':e=='recovery_locked_hard'?'リカバリーコードでは開けません。救済リセットをご利用ください':e=='wrong_last4'?'下4文字が違います。控えたコードを見直してください':e=='setup_abandoned'?'確認できなかったため設定を取り消しました。最初からやり直してください':e=='too_many_tries'?'確認の回数が上限に達しました。控えたコードはそのまま使えます':e=='unlock_required'?'もう一度ロックを解除してください':e=='too_many_devices'?'生体認証を登録できる端末は5台までです':e=='rate_limited'?'本日の申請の上限に達しました':'うまくいきませんでした（'+esc(e||'error')+'）'}
function lockLoad(cb){lapi('lock').then(function(j){L.st=j;cb&&cb(j)},function(e){err(msgOf(e))})}
// Unlock for a risky action: biometrics first (if this device enrolled), else the passcode.
function needUnlock(cb,fresh){if(!fresh&&L.su&&Date.now()<L.suExp-10000)return cb(L.su);bmInit(function(B){if(B&&B.isBiometricTokenSaved&&lsGet('th_bio_id')){try{B.authenticate({reason:'本人確認のため'},function(ok,tok){if(!ok||!tok)return pinUnlock(cb);lapi('lock/bio/unlock',{token:tok}).then(function(j){if(j.ok){setSu(j);var done=function(saved){if(!saved){lsSet('th_bio_id',null);err('この端末の'+bmName()+'を更新できませんでした。次回はパスコードで開き、設定から登録し直してください')}hp(saved?'success':'warning');cb(j.stepUp)};try{B.updateBiometricToken(j.token,function(ok){done(!!ok)})}catch(e){done(false)}}else{if(j.error=='bio_revoked'||j.error=='bio_invalid'){try{B.updateBiometricToken('')}catch(e){}lsSet('th_bio_id',null)}pinUnlock(cb)}},function(e){err(msgOf(e))})})}catch(e){pinUnlock(cb)}}else pinUnlock(cb)})}
function pinUnlock(cb){pinStart('unlock',cb)}
function pinStart(m,cb){if(S.sub!='pin')L.ret=S.sub;L.seq++;L.subm=0;L.mode=m;L.pin='';L.msg='';L.cb=cb||null;push('pin')}
function pinBack(){L.seq++;L.subm=0;S.sub=L.ret;L.ret=null;render()}
var PT={'new':'新しいパスコード（6桁）',confirm:'確認のため、もう一度',unlock:'パスコードを入力',change:'新しいパスコード（6桁）',change2:'確認のため、もう一度',rnew:'新しいパスコード（6桁）',rnew2:'確認のため、もう一度'};
function pin(){var h=back()+'<div class=pin><div class=pi aria-hidden=true>🔐</div><h2 id=pt>'+PT[L.mode]+'</h2><div class=dots role=img aria-label="'+L.pin.length+'/6桁">';for(var i=0;i<6;i++)h+='<i'+(i<L.pin.length?' class=on':'')+'></i>';
h+='</div><p class=pmsg role=alert>'+esc(L.msg)+'</p><div class=kp>';[1,2,3,4,5,6,7,8,9,'',0,'del'].forEach(function(k){h+=k===''?'<span></span>':'<button data-k="'+k+'" aria-label="'+(k=='del'?'1文字消す':k)+'">'+(k=='del'?'⌫':k)+'</button>'});
h+='</div>'+(L.mode=='unlock'?'<button class=lk id=fg>パスコードを忘れたとき</button>':'')+'</div>';A.innerHTML=h;A.querySelectorAll('.kp button').forEach(function(b){b.onclick=function(){pinKey(b.dataset.k)}});var f=$('fg');if(f)f.onclick=function(){hp('sel');S.sub=null;push('rec')};main('',null);sec('',null)}
function pinKey(k){if(L.busy||L.subm)return;if(k=='del'){L.pin=L.pin.slice(0,-1);hp('sel');return render()}if(L.pin.length>=6)return;L.pin+=k;hp('sel');render();if(L.pin.length==6){var p=L.pin,q=++L.seq;L.subm=1;setTimeout(function(){L.subm=0;if(q==L.seq&&S.sub=='pin')pinDone(p)},120)}}
document.addEventListener('keydown',function(e){if(S.sub!='pin')return;if(/^[0-9]$/.test(e.key))pinKey(e.key);else if(e.key=='Backspace')pinKey('del')});
function pinAgain(m,msg){L.mode=m;L.pin='';L.msg=msg||'';hp('error');render()}
function pinDone(p){var m=L.mode;L.pin='';
if(m=='new'||m=='change'||m=='rnew'){L.pin1=p;L.mode=m=='new'?'confirm':m+'2';L.msg='';return render()}
if(m=='confirm'||m=='change2'||m=='rnew2'){var first={confirm:'new',change2:'change',rnew2:'rnew'}[m];if(p!==L.pin1)return pinAgain(first,'一致しませんでした。もう一度最初から入力してください');var b={passcode:p},path=m=='rnew2'?'lock/recover':'lock/setup';if(m=='change2')b.stepUp=L.su;if(m=='rnew2')b.code=L.rc;
L.busy=1;return lapi(path,b).then(function(j){L.busy=0;L.pin1='';if(j.recoveryCode){L.rc=null;if(j.stepUp)setSu(j);if(m=='rnew2'&&lsGet('th_bio_id')){lsSet('th_bio_id',null);try{BM&&BM.updateBiometricToken('')}catch(e){}}L.code=j.recoveryCode;S.sub='rc';L.ret=null;render();try{T.HapticFeedback.notificationOccurred('success')}catch(e){}}else if(j.ok){hp('success');L.st=null;pinBack()}else if(j.error=='unlock_required'){L.pin1='';pinBack();err(lmsg(j))}else if(m=='rnew2'&&/recovery/.test(j.error)){L.rc=null;S.sub='rec';L.msg=lmsg(j);render();hp('error')}else pinAgain(first,lmsg(j))},function(e){L.busy=0;err(msgOf(e))})}
if(m=='unlock'){L.busy=1;lapi('lock/unlock',{passcode:p}).then(function(j){L.busy=0;if(j.ok){setSu(j);hp('success');var cb=L.cb;L.cb=null;pinBack();if(cb)cb(j.stepUp)}else{L.st=null;pinAgain('unlock',lmsg(j))}},function(e){L.busy=0;err(msgOf(e))})}}
// The recovery code: shown once, copied or written down, confirmed with its last 4 characters.
function rc(){if(!L.code){S.sub='lock';return render()}A.innerHTML='<div class=top><h1>リカバリーコード</h1><p>パスコードを忘れたときに使います</p></div><div class=rcb><code id=rcv>'+esc(L.code)+'</code><button id=cp>コピー</button></div><div class=lg><ul><li>この画面を閉じると二度と表示されません。紙に書くか、パスワード管理アプリに保存してください。</li><li>1回使うと無効になり、新しいコードに変わります。</li><li>運営がこのコードを聞くことはありません。誰にも教えないでください。</li></ul></div><div class=lg><label for=l4>控えたら、コードの最後の4文字を入力してください</label><input id=l4 class=in maxlength=4 autocomplete=off autocapitalize=characters spellcheck=false inputmode=text></div>';
$('cp').onclick=function(){hp('tap');try{navigator.clipboard.writeText(L.code).then(function(){$('cp').textContent='コピーしました'},function(){})}catch(e){}};main('確認して続ける',rcConfirm);sec('',null)}
function rcConfirm(){var v=($('l4')||{}).value||'';if(L.busy)return;L.busy=1;lapi('lock/confirm-recovery',{last4:v}).then(function(j){L.busy=0;if(j.ok){L.code=null;if(j.stepUp)setSu(j);L.st=null;hp('success');S.sub='lock';render();offerBio()}else if(j.error=='setup_abandoned'||j.error=='nothing_to_confirm'){L.code=null;L.st=null;S.sub='lock';render();err(lmsg(j))}else err(lmsg(j))},function(e){L.busy=0;err(msgOf(e))})}
function offerBio(){bmInit(function(B){if(!B||lsGet('th_bio_id'))return;sheet({icon:B.biometricType=='face'?'🙂':'👆',title:bmName()+'も使いますか',text:'次からは'+bmName()+'で確認できます（パスコードはそのまま使えます）。この端末だけの設定です。',btn:'使う',fn:function(){needUnlock(bioEnroll)}})})}
function bioEnroll(su){bmInit(function(B){if(!B)return;try{B.requestAccess({reason:'解約・返金の申請の前の本人確認に使います'},function(ok){if(!ok){sheet({icon:'⚙️',title:bmName()+'が許可されていません',text:'Telegram の設定でこの Mini App に'+bmName()+'の利用を許可してから、もう一度お試しください。',btn:'設定を開く',fn:function(){try{B.openSettings()}catch(e){}}});return}
lapi('lock/bio/enroll',{stepUp:su,type:B.biometricType,label:devName()}).then(function(j){if(!j.ok)return err(lmsg(j));B.updateBiometricToken(j.token,function(saved){if(saved){lsSet('th_bio_id',j.id);hp('success')}else{lapi('lock/bio/'+j.id,{stepUp:su},'DELETE');err('この端末に保存できませんでした')}L.st=null;render()})},function(e){err(msgOf(e))})})}catch(e){err('この端末では使えません')}})}
function lockRow(id,ic,t,sub){return '<button class=lr id='+id+'><span>'+ic+'</span><span>'+t+(sub?'<br><small class=mu>'+sub+'</small>':'')+'</span><span class=ch>›</span></button>'}
function lock(){var s=L.st;if(!s){A.innerHTML=back()+'<div class=top><h1>🔐 アプリロック</h1><p>読み込み中…</p></div><div class=sk></div>';main('',null);sec('',null);lockLoad(function(){if(S.sub=='lock')render()});return}
var h=back()+'<div class=top><h1>🔐 アプリロック</h1><p>'+(s.on?'オン：大事な操作の前に本人確認します':s.pending?'設定の途中です':'オフ')+'</p></div>';
if(!s.on){h+='<div class=lg><h3>アプリロックとは</h3><ul><li>解約・返金の申請など大事な操作の前だけ、6桁のパスコード（または Face ID・指紋）で本人か確かめます。</li><li>Mini App を開くたびには聞きません。会員証の表示やお支払いはこれまでどおりです。</li><li>使うかどうかは自由で、いつでも外せます。</li><li>Telegram アカウントの2段階認証とは別のものです。</li></ul></div>';A.innerHTML=h;main('アプリロックを有効にする',function(){pinStart('new')});sec(s.pending?'設定をやめる':'',function(){lapi('lock/disable',{}).then(function(){L.st=null;render()})});return}
if(s.hard||s.lockedUntil)h+='<div class=err role=alert>⚠️ '+(s.hard?'まちがいが続いたため、パスコードでは開けません。リカバリーコードか救済リセットを使ってください。':'パスコードは '+jt(s.lockedUntil)+' まで入力できません。')+'</div>';
if(s.rescue)h+='<div class=err role=alert>🕒 救済リセットを受付中：'+jt(s.rescue.executeAfter)+' 以降に'+(s.rescue.state=='awaiting_owner_approval'?'運営の確認後に':'')+'ロックが外れます。心当たりがなければ取り消してください。<br><button id=rx>救済リセットを取り消す</button></div>';
h+='<div class=sec>生体認証</div><div class=lst>';var mine=lsGet('th_bio_id'),here=false;s.devices.forEach(function(d){if(d.id==mine)here=true;h+='<div class=lr><span>'+(d.type=='face'?'🙂':'👆')+'</span><span>'+esc(d.label)+(d.id==mine?'（この端末）':'')+'<br><small class=mu>登録 '+jt(d.createdAt)+(d.lastUsedAt?'・最後に使用 '+jt(d.lastUsedAt):'')+'</small></span><button class=lk data-d='+d.id+'>削除</button></div>'});
if(!s.devices.length)h+='<div class=lr><span>—</span><span class=mu>登録している端末はありません</span></div>';h+='</div><div id=bioadd></div>';
h+='<div class=sec>パスコード</div><div class=lst>'+lockRow('lc','🔢','パスコードを変更')+lockRow('lr','🧾','パスコードを忘れたとき','リカバリーコードで開けます')+lockRow('lx','🆘','リカバリーコードもないとき','救済リセット（72時間後に解除）')+'</div>';
h+='<div class=sec>オフにする</div><div class=lst>'+lockRow('lo','🔓','アプリロックを外す')+'</div><div class=note>運営からパスコードやリカバリーコードを聞くことはありません。</div>';A.innerHTML=h;
A.querySelectorAll('[data-d]').forEach(function(b){b.onclick=function(){var id=b.dataset.d;needUnlock(function(su){lapi('lock/bio/'+id,{stepUp:su},'DELETE').then(function(j){if(!j.ok)return err(lmsg(j));L.su=null;if(id==lsGet('th_bio_id')){lsSet('th_bio_id',null);try{BM&&BM.updateBiometricToken('')}catch(e){}}L.st=null;hp('success');render()})})}});
bmInit(function(B){var x=$('bioadd');if(!x||!B||here)return;x.innerHTML='<div class=lst style="margin-top:8px">'+lockRow('lb',B.biometricType=='face'?'🙂':'👆','この端末で'+bmName()+'を使う')+'</div>';$('lb').onclick=function(){needUnlock(bioEnroll)}});
$('lc').onclick=function(){needUnlock(function(){pinStart('change')})};$('lr').onclick=function(){hp('tap');L.msg='';push('rec')};$('lx').onclick=function(){sheet({icon:'🆘',title:'救済リセット',text:'パスコードもリカバリーコードも分からないときは、このBotとのチャットで /applock_reset と送ってください。72時間後にロックが外れます（会員資格・注文はそのまま）。受付のお知らせはそのチャットに届き、心当たりがなければ /applock_cancel で取り消せます。',btn:'チャットに戻る',fn:function(){if(T)T.close()}})};
var rx=$('rx');if(rx)rx.onclick=function(){lapi('lock/rescue',{},'DELETE').then(function(){L.st=null;hp('success');render()},function(e){err(msgOf(e))})};
$('lo').onclick=function(){needUnlock(function(su){lapi('lock/disable',{stepUp:su}).then(function(j){if(!j.ok)return err(lmsg(j));L.st=null;L.su=null;if(BM&&lsGet('th_bio_id')){try{BM.updateBiometricToken('')}catch(e){}lsSet('th_bio_id',null)}hp('success');render()})})};main('',null);sec('',null)}
function rec(){A.innerHTML=back()+'<div class=top><h1>リカバリーコードで開く</h1><p>設定のときに控えたコード（THR- で始まる）を入力してください</p></div>'+(L.msg?'<div class=err role=alert>'+esc(L.msg)+'</div>':'')+'<div class=lg><label for=rcin>リカバリーコード</label><input id=rcin class=in autocomplete=off autocapitalize=characters spellcheck=false placeholder="THR-XXXXX-XXXXX-XXXXX-XXXXX"></div><div class=note>使うとこのコードは無効になり、新しいパスコードと新しいリカバリーコードを設定します。登録済みの生体認証はすべて解除されます。</div>';
main('次へ（新しいパスコードを設定）',function(){var v=($('rcin')||{}).value||'';if(!/[A-Za-z0-9]{20}/.test(v.replace(/[ -]/g,'').replace(/^THR/i,'')))return err('コードを最後まで入力してください');L.rc=v;L.msg='';L.ret='lock';L.mode='rnew';L.pin='';S.sub='pin';render()});sec('',null)}
// Cancellation / refund request: a support ticket. With the member's lock on it needs an unlock first.
function req(){var s=L.st;if(!s){A.innerHTML=back()+'<div class=top><h1>解約・返金の申請</h1><p>読み込み中…</p></div><div class=sk></div>';main('',null);sec('',null);lockLoad(function(){if(S.sub=='req')render()});return}
A.innerHTML=back()+'<div class=top><h1>解約・返金の申請</h1><p>運営が内容と注文を確認してチャットでご連絡します</p></div><div class=sec>申請の種類</div><div class=lst><button class=lr id=k1 aria-pressed='+(L.kind=='cancel')+'><span>'+(L.kind=='cancel'?'◉':'○')+'</span>解約（自動更新の停止）</button><button class=lr id=k2 aria-pressed='+(L.kind=='refund')+'><span>'+(L.kind=='refund'?'◉':'○')+'</span>返金</button></div><div class=lg><label for=rt>くわしい内容（任意・800文字まで）</label><textarea id=rt class=in rows=4 maxlength=800></textarea></div><div class=note>'+(s.on?'🔐 アプリロックがオンなので、送る前に本人確認をします。':'送った内容は /paysupport のお問い合わせと同じ窓口に届きます。')+' Stars の自動更新は Telegram の 設定 → Telegram Stars からも止められます。</div>';
var keep=L.txt||'';$('rt').value=keep;$('rt').oninput=function(){L.txt=this.value};$('k1').onclick=function(){L.kind='cancel';hp('sel');render()};$('k2').onclick=function(){L.kind='refund';hp('sel');render()};main('申請する',reqSend);sec('',null)}
function reqSend(){var go2=function(){var s=L.st;if(s&&s.on)needUnlock(function(su){reqPost(su)},true);else reqPost(null)};var q=(L.kind=='cancel'?'解約':'返金')+'を申請します。よろしいですか？';try{if(ver('6.2'))return T.showConfirm(q,function(ok){if(ok)go2()})}catch(e){}if(window.confirm(q))go2()}
function reqPost(su){if(S.busy)return;S.busy=1;busy(true);lapi('request',{kind:L.kind,text:L.txt||'',stepUp:su}).then(function(j){S.busy=0;busy(false);L.su=null;if(j.ok){L.txt='';hp('success');S.sub=null;S.tab='more';render();sheet({icon:'✅',title:'申請を受け付けました',text:'受付番号 '+j.id+'。運営が確認して、このBotとのチャットでご連絡します。',btn:'閉じる'})}else if(j.error=='unlock_required'){lockLoad(function(st){if(st.on)needUnlock(function(su){reqPost(su)},true);else err(lmsg(j))})}else err(lmsg(j))},function(e){S.busy=0;busy(false);err(msgOf(e))})}
// ---- start
TB.querySelectorAll('button').forEach(function(b){b.onclick=function(){go(b.dataset.t)}});
(function(){var q=/[?&]p=([a-z]+)/.exec(location.search);if(q)S.want=q[1]})();
if(!T||!T.MainButton)document.body.classList.add('nomain');
function theme(){try{if(ver('6.1')){T.setHeaderColor('secondary_bg_color');T.setBackgroundColor('secondary_bg_color')}if(ver('7.10'))T.setBottomBarColor('bg_color')}catch(e){}document.documentElement.style.colorScheme=T.colorScheme||'light'}
if(T){T.ready();T.expand();theme();T.onEvent('themeChanged',theme);if(NB)T.BackButton.onClick(goBack);if(ver('6.10')){try{T.SettingsButton.onClick(function(){hp('sel');go('more')});T.SettingsButton.show()}catch(e){}}}
refresh()})()`;

export function appHtml(nonce) {
  return `<!doctype html><html lang=ja><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><title>会員プラン | ${SALON}</title>
<script src="${TELEGRAM_SDK}"></script><style>${PAGE_CSS}</style></head><body><main id=a aria-live=polite></main><button class="cta fb" id=fbm></button><button class="fb" id=fbs></button>
<nav class=tabs id=tabs aria-label=メニュー><button data-t=home><i aria-hidden=true>🏠</i>ホーム</button><button data-t=plans><i aria-hidden=true>⭐</i>プラン</button><button data-t=card><i aria-hidden=true>🪪</i>会員証</button><button data-t=more><i aria-hidden=true>☰</i>その他</button></nav>
<div class=sh id=sh hidden><div class=shb></div><div class=shp id=shp role=dialog aria-modal=true aria-labelledby=sht><div class=shg aria-hidden=true></div><button class=shx id=shx aria-label=閉じる>✕</button><div id=shc></div></div></div>
<script nonce="${nonce}">${PAGE_JS}</script></body></html>`;
}
