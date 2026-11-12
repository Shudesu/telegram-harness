// t79u Mini App: the dedicated "💳 決済・会員" entry. Plan → Stars invoice (openInvoice) → done →
// membership card. Served by this Worker at /app/ (the old carousel on the demo Worker is untouched).
//
// Money safety: the Stars invoice is only created when PAY_LIVE === "1" (on in production since t80u,
// 2026-11-11, owner-approved), always for the registered SKU app-<plan> at its registered price.
// Otherwise every checkout is a TEST invoice drawn by the page itself: nothing is created at
// Telegram, nothing can be paid, nothing is charged. External providers (Stripe / KOMOJU / bank
// transfer) are shown as 準備中 unless their keys are configured.
import {createHmac, timingSafeEqual, randomBytes} from 'node:crypto';
import {providerStatus} from '../membership/providers/index.mjs';
import {CSS as WIDGET_CSS} from './ui.mjs';
import {memberNo as memberNoOf} from './flow.mjs';
import {APP_PLANS, SALON, planById, billingLabel, PERIOD_DAYS} from './plans.mjs';
import {TOKUSHO, TERMS_POINTS} from './legal.mjs';
export {APP_PLANS};
const untilOf = ms => { const d = new Date(ms + 9 * 3600000); return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };

const MAX_AGE_S = 24 * 3600;

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function verifyInitData(raw, token, now = Date.now()) {
  if (typeof raw !== 'string' || raw.length > 4096 || !token) return null;
  const p = new URLSearchParams(raw), hash = p.get('hash');
  if (!/^[a-f0-9]{64}$/.test(hash ?? '')) return null;
  p.delete('hash');
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const want = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(want, Buffer.from(hash, 'hex'))) return null;
  const auth = Number(p.get('auth_date'));
  if (!Number.isSafeInteger(auth) || now / 1000 - auth > MAX_AGE_S || auth - now / 1000 > 300) return null;
  let user; try { user = JSON.parse(p.get('user')); } catch { return null; }
  return Number.isSafeInteger(user?.id) && user.id > 0 ? {id: user.id, first_name: String(user.first_name ?? '').slice(0, 64)} : null;
}

const json = (body, status = 200) => Response.json(body, {status, headers: {'cache-control': 'no-store'}});
const providers = env => providerStatus(env).filter(p => p.id !== 'telegram_stars').map(p => ({id: p.id, label: p.label, ready: p.configured}));
export const payLive = env => env?.PAY_LIVE === '1';

// Routes under /app/. Returns null for anything else.
export async function appFetch(request, env, {now = Date.now()} = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/app')) return null;
  if (request.method === 'GET' && (url.pathname === '/app/' || url.pathname === '/app')) {
    return new Response(APP_HTML, {headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline' https://telegram.org; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org"}});
  }
  const m = request.method === 'POST' && /^\/app\/api\/(state|checkout|complete)$/.exec(url.pathname);
  if (!m) return new Response('not_found', {status: 404});
  let body; try { body = await request.json(); } catch { return json({error: 'bad_request'}, 400); }
  const user = verifyInitData(body?.initData, env.BOT_TOKEN, now);
  if (!user) return json({error: 'unauthorized'}, 401);
  const chat = env.CHAT.getByName(`chat:${user.id}`);
  if (m[1] === 'state') {
    // Live: the membership service's entitlement is the truth; TEST: the record the demo wrote.
    let member;
    if (payLive(env) && env.MEMBERSHIP === '1') {
      const e = await env.CHAT.getByName(`membership:${env.TENANT_ID ?? 'main'}`).membership('app_member', {userId: user.id});
      member = e ? {no: memberNoOf(user.id), pl: planById(e.planId)?.name ?? e.title, until: e.expiresAt ? untilOf(e.expiresAt) : '無期限', renew: e.autoRenew === true, links: e.links ?? [], live: true} : null;
    } else member = await chat.studioApp('member', null);
    return json({user: {first_name: user.first_name}, salon: SALON, plans: APP_PLANS.map(p => ({...p, bill: billingLabel(p)})), providers: providers(env), live: payLive(env), member,
      legal: {terms: TERMS_POINTS, tokusho: TOKUSHO}});
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
const PAGE_CSS = `${WIDGET_CSS}
html,body{background:var(--tg-theme-secondary-bg-color,var(--s2))}body{padding-bottom:24px;font-size:15px}
.hero{padding:22px 18px 26px;color:#fff;background:var(--gr);border-radius:0 0 22px 22px}.hero h1{margin:0;font-size:22px}.hero p{margin:4px 0 0;opacity:.9;font-size:13px}
.pill{display:inline-block;margin-top:10px;padding:4px 10px;border-radius:99px;background:rgba(255,255,255,.22);font-size:12px}
.sec{margin:16px 14px 6px;font-size:12px;color:var(--ht);letter-spacing:.04em}
.pc{display:block;width:calc(100% - 28px);margin:8px 14px;padding:14px;text-align:left;border-radius:16px;background:var(--bg);border:2px solid transparent;color:var(--tx);font-size:15px}
button.pc.on{background:var(--bg);color:var(--tx);border-color:var(--bt);box-shadow:0 6px 18px color-mix(in srgb,var(--bt) 25%,transparent)}.pc .top{display:flex;align-items:center;gap:8px}.pc b{font-size:17px}.pc .pr{margin-left:auto;font-weight:700}.pc ul{margin:8px 0 0;padding-left:18px;color:var(--ht);font-size:13px}
.tg{font-size:11px;padding:2px 7px;border-radius:99px;background:var(--gr);color:#fff}
.pm{display:flex;align-items:center;gap:10px;margin:0 14px;padding:12px 14px;background:var(--bg);border-bottom:1px solid var(--s2)}.pm:first-of-type{border-radius:14px 14px 0 0}.pm:last-child{border-radius:0 0 14px 14px;border-bottom:0}
.pm .st{margin-left:auto;font-size:12px;color:var(--ht)}.pm .st.ok{color:var(--ok)}.pm.off{opacity:.55}
.sheet{margin:14px;padding:18px;border-radius:18px;background:var(--bg);text-align:center}.sheet .amt{font-size:34px;font-weight:800;margin:6px 0}
.note{margin:10px 14px;padding:10px 12px;border-radius:12px;font-size:12px;background:var(--bg);color:var(--ht)}
.card{margin:14px;padding:18px;border-radius:20px;color:#fff;background:var(--gr);display:flex;gap:14px;align-items:center;box-shadow:0 10px 30px rgba(91,75,255,.3)}.card .q{background:#fff;border-radius:10px;padding:6px}.card b{font-size:18px}.card .n{font:12px/1.6 ui-monospace,monospace;opacity:.92}
.ok-ic{width:64px;height:64px;margin:6px auto;border-radius:50%;background:var(--ok);color:#fff;font-size:34px;display:flex;align-items:center;justify-content:center;animation:pop .35s ease-out}@keyframes pop{from{transform:scale(.4);opacity:0}}
.sk{height:96px;margin:10px 14px;border-radius:16px;background:linear-gradient(90deg,var(--bg),var(--s2),var(--bg));background-size:200% 100%;animation:sh 1.2s infinite}@keyframes sh{to{background-position:-200% 0}}
.err{margin:12px 14px;padding:12px;border-radius:12px;background:color-mix(in srgb,var(--ng) 14%,var(--bg));color:var(--ng);font-size:13px}.err button{margin-top:8px;background:var(--ng);color:#fff;padding:8px 14px}
.pc .ds{margin:6px 0 0;font-size:13px;line-height:1.5}.pc .bl{display:inline-block;margin-top:6px;font-size:11px;padding:2px 8px;border-radius:99px;background:var(--s2);color:var(--ht)}
.lk{background:none;border:0;padding:0;color:var(--lk,var(--bt));text-decoration:underline;font-size:12px}
.lg{margin:10px 14px;padding:14px;border-radius:14px;background:var(--bg);font-size:13px;line-height:1.6}.lg h3{margin:0 0 6px;font-size:14px}.lg ul{margin:0 0 6px;padding-left:18px}.lg dt{font-weight:700;margin-top:6px}.lg dd{margin:0;color:var(--ht)}
.fb{display:none}.nomain .fb{display:block;width:calc(100% - 28px);margin:12px 14px}`;

const PAGE_JS = `var T=window.Telegram&&Telegram.WebApp,S={plan:1,data:null,inv:null},A=document.getElementById('a');
function hp(k){try{k=='sel'?T.HapticFeedback.selectionChanged():k=='tap'?T.HapticFeedback.impactOccurred('light'):T.HapticFeedback.notificationOccurred(k)}catch(e){}}
function api(p,b){b=b||{};b.initData=T&&T.initData||'';return fetch('/app/api/'+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw Error(j.error||r.status);return j})})}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
var mainCb=null,secCb=null;
function main(t,f,prog){var M=T&&T.MainButton;mainCb=f;if(!M){fb('m',t,f);return}M.offClick(M._cb||function(){});M._cb=function(){hp('tap');f()};M.onClick(M._cb);M.setParams({text:t,is_visible:!!t,is_active:true,has_shine_effect:!!t});prog?M.showProgress(false):M.hideProgress()}
function sec(t,f){var B=T&&T.SecondaryButton;secCb=f;if(!B){fb('s',t,f);return}B.offClick(B._cb||function(){});B._cb=function(){hp('tap');f()};B.onClick(B._cb);B.setParams({text:t||'',is_visible:!!t,position:'bottom'})}
function fb(k,t,f){var b=document.getElementById('fb'+k);if(!b)return;b.textContent=t||'';b.style.display=t?'block':'none';b.onclick=f}
function busy(on){var M=T&&T.MainButton;if(M)on?M.showProgress(false):M.hideProgress()}
function err(m,retry){var d=document.createElement('div');d.className='err';d.innerHTML='⚠️ '+esc(m);if(retry){var b=document.createElement('button');b.textContent='もう一度';b.onclick=function(){d.remove();retry()};d.appendChild(document.createElement('br'));d.appendChild(b)}A.prepend(d);hp('error')}
function msgOf(e){var c=String(e&&e.message||e);return c=='unauthorized'?'Telegramから開き直してください（認証の有効期限切れ）':c=='invoice_unavailable'?'このプランは現在お申し込みできません':c=='pending_approval'?'確認中です。承認後にチャットへご案内します':'通信できませんでした（'+c+'）'}
function qr(n){var s='<svg width=84 height=84 viewBox="0 0 21 21" shape-rendering=crispEdges>',x=0;for(var i=0;i<n.length;i++)x=(x*31+n.charCodeAt(i))%2147483647;function f(a,b){s+='<rect x='+a+' y='+b+' width=7 height=7 /><rect x='+(a+1)+' y='+(b+1)+' width=5 height=5 fill=#fff /><rect x='+(a+2)+' y='+(b+2)+' width=3 height=3 />'}for(var r=0;r<21;r++)for(var c=0;c<21;c++){if((r<8&&c<8)||(r<8&&c>12)||(r>12&&c<8))continue;x=(x*1103515245+12345)%2147483648;if(x%3==0)s+='<rect x='+c+' y='+r+' width=1 height=1 />'}f(0,0);f(14,0);f(0,14);return s+'</svg>'}
function hero(t,p,pill){return '<div class=hero><h1>'+t+'</h1><p>'+p+'</p>'+(pill?'<span class=pill>'+pill+'</span>':'')+'</div>'}
function loading(){A.innerHTML=hero('💳 決済・会員','読み込み中…')+'<div class=sk></div><div class=sk></div><div class=sk></div>'}
function plans(){var d=S.data,m=d.member,h=hero('💎 '+esc(d.salon),(d.user.first_name?esc(d.user.first_name)+' さん、':'')+'プランを選んで Telegram Stars で登録',m?'⭐ '+esc(m.pl)+'会員'+(m.live?'':'（テスト）'):'未登録');
h+='<div class=sec>プラン</div>';d.plans.forEach(function(p,k){h+='<button class="pc'+(k==S.plan?' on':'')+'" data-k='+k+'><div class=top><b>'+esc(p.name)+'</b>'+(p.tag?'<span class=tg>'+esc(p.tag)+'</span>':'')+'<span class=pr>⭐ '+p.stars+' <small>/30日</small></span></div><div class=ds>'+esc(p.desc)+'</div><span class=bl>'+(p.recurring?'🔁 ':'')+esc(p.bill)+'</span><ul>'+p.f.map(function(f){return '<li>'+esc(f)+'</li>'}).join('')+'</ul></button>'});
h+='<div class=sec>支払い方法</div><div><div class=pm>⭐ <b>Telegram Stars</b><span class="st ok">'+(d.live?'利用可':'テスト（実請求なし）')+'</span></div>';d.providers.forEach(function(p){h+='<div class="pm'+(p.ready?'':' off')+'">'+({stripe:'💳',komoju:'🏪',bank_gmo:'🏦'}[p.id]||'•')+' '+esc(p.label)+'<span class=st>'+(p.ready?'利用可':'準備中')+'</span></div>'});h+='</div>';
h+='<div class=note>デジタル会員権はTelegram規約によりStarsで販売します。カード等の外部決済は予約・店舗サービスのみ対象で、現在は準備中です。<br>自動更新はTelegramの設定からいつでも停止できます。お申し込みで<button class=lk id=tm>利用規約・特商法表記</button>に同意したものとみなします。お問い合わせはチャットで /paysupport</div>';
A.innerHTML=h;document.getElementById('tm').onclick=function(){hp('sel');terms()};A.querySelectorAll('.pc').forEach(function(b){b.onclick=function(){if(S.busy)return;S.plan=+b.dataset.k;hp('sel');plans()}});
var p=d.plans[S.plan];main('⭐ '+p.stars+' Stars で登録',checkout);sec(m?'🪪 会員証を見る':'',m?function(){done(m)}:null)}
function terms(){var L=S.data.legal,h=hero('📄 利用規約','特定商取引法に基づく表記')+'<div class=lg><h3>利用規約（要約）</h3><ul>'+L.terms.map(function(t){return '<li>'+esc(t)+'</li>'}).join('')+'</ul></div><div class=lg><h3>特定商取引法に基づく表記</h3><dl>'+L.tokusho.map(function(r){return '<dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd>'}).join('')+'</dl></div>';A.innerHTML=h;window.scrollTo(0,0);main('プランに戻る',plans);sec('',null)}
function key(m){return m?m.pl+'|'+m.until+'|'+(m.renew?1:0):''}
function checkout(){if(S.busy)return;var k=S.plan,p=S.data.plans[k],before=key(S.data.member);S.busy=1;busy(true);api('checkout',{plan:p.id}).then(function(r){S.busy=0;busy(false);if(r.mode=='live'){T.openInvoice(r.link,function(st){if(st=='paid'){hp('success');waitMember(0,before)}else if(st=='failed'){err('支払いに失敗しました',checkout)}else if(st=='cancelled'){hp('warning')}})}else{S.inv=r.invoice;S.inv.plan=k;sheet()}},function(e){S.busy=0;busy(false);err(msgOf(e),checkout)})}
function sheet(){var i=S.inv;A.innerHTML=hero('🧾 お支払い確認','TEST 請求書（実際のStarsは動きません）')+'<div class=sheet><div class=mu>'+esc(i.title)+'</div><div class=amt>⭐ '+i.stars+'</div><div class=mu>請求番号 '+esc(i.id)+'</div></div><div class=note>本番では Telegram 公式の支払い画面（openInvoice）が開きます。いまはデモのため、この画面でテスト完了まで進みます。</div>';
main('テスト支払いを完了する',pay);sec('キャンセル',function(){hp('warning');plans()})}
function pay(){if(S.busy)return;var p=S.data.plans[S.inv.plan];S.busy=1;busy(true);api('complete',{plan:p.id,invoice:S.inv.id}).then(function(r){S.busy=0;busy(false);S.data.member=r.member;hp('success');done(r.member,1)},function(e){S.busy=0;busy(false);err(msgOf(e),pay)})}
function done(m,fresh){A.innerHTML=hero(fresh?'登録完了':'🪪 会員証',fresh?(m.live?'お支払いが完了しました。会員資格が有効になりました':'テスト決済が完了しました（実請求なし）'):(m.live?'有効な会員資格です':'チャットの会員証ウィジェットにも反映されます'))+(fresh?'<div class=ok-ic>✓</div>':'')+'<div class=card><div class=q>'+qr(m.no)+'</div><div><div class=n>TELEHARNESS MEMBER</div><b>⭐ '+esc(m.pl)+'会員</b><div class=n>No. '+esc(m.no)+'</div><div class=n>'+(m.renew?'次回更新 ':'有効期限 ')+esc(m.until)+'</div></div></div><div class=note>'+(m.live?'お支払いは Telegram Stars で処理されました。'+(m.links&&m.links.length?'':'会員グループは準備中です（開設しだいチャットでご案内します）。')+(m.renew?'自動更新は Telegram の 設定 → Telegram Stars → サブスクリプション から停止できます。':'')+'返金・お問い合わせはチャットで /paysupport':'この会員証はデモです。実在の会員資格・入会はありません。')+'</div>';
(m.links||[]).forEach(function(u,i){if(String(u).indexOf('https://t.me/')!==0)return;var b=document.createElement('button');b.className='pc';b.textContent='👥 会員グループ'+(i+1)+'に参加申請';b.onclick=function(){try{T.openTelegramLink(u)}catch(e){location.href=u}};A.appendChild(b)});
main('チャットに戻る',function(){T&&T.close()});sec('プランを見る',plans)}
function waitMember(n,before){loading();api('state').then(function(d){S.data=d;if(d.member&&key(d.member)!=before)done(d.member,1);else if(n<6)setTimeout(function(){waitMember(n+1,before)},1500);else{plans();err('支払いを受け付けました。会員反映まで少しお待ちください')}},function(e){err(msgOf(e),function(){waitMember(0,before)})})}
function refresh(paid){loading();api('state').then(function(d){S.data=d;if(S.want){d.plans.forEach(function(p,k){if(p.id==S.want)S.plan=k});S.want=null}if(paid&&d.member)done(d.member,1);else plans()},function(e){A.innerHTML=hero('💳 決済・会員','');err(msgOf(e),refresh);main('',null);sec('',null)})}
(function(){var q=/[?&]p=([a-z]+)/.exec(location.search);if(q)S.want=q[1]})();
if(!T||!T.MainButton)document.body.classList.add('nomain');
if(T){T.ready();T.expand();try{T.setHeaderColor('bg_color');T.setBackgroundColor('secondary_bg_color')}catch(e){}document.documentElement.style.colorScheme=T.colorScheme||'light';T.onEvent('themeChanged',function(){document.documentElement.style.colorScheme=T.colorScheme})}
refresh()`;

export const APP_HTML = `<!doctype html><html lang=ja><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><title>会員プラン | ${SALON}</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script><style>${PAGE_CSS}</style></head><body><main id=a></main><button class="cta fb" id=fbm></button><button class="fb" id=fbs></button><script>${PAGE_JS}</script></body></html>`;
