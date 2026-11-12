// Pure additive adapter for the existing sole poller. Importing this file does not poll/send.
// io.call is supplied ONLY by the trusted existing Bot API transport, never public HTTP.
import {randomBytes, createHash} from 'node:crypto';
import {dispatch as legacyDispatch, expire, recover as legacyRecover, session as legacySession, TTL, FRESH} from './engine.mjs';
import {catalog, CATALOG_VERSION} from './catalog.mjs';
import {validatePayload, canonicalSummary} from './protocol.mjs';
export {fresh} from './engine.mjs';
export const GENERATION = 'miniapp-t17u-20261107';
export const BUTTON = '🧪 スタッフをスワイプして選ぶ';
export const LAUNCH_TTL = 15*60*1000;
const hash = s=>createHash('sha256').update(s).digest('hex');
const init = g => g.miniapp ??= {version:1,sessions:{},events:{}};
const nowOf = io => io.now?.() ?? Date.now();
const privateSender = m => m?.chat?.type==='private' && Number.isSafeInteger(m.from?.id) && m.from.id>0 && m.from.is_bot===false && m.from.id===m.chat.id && Number.isSafeInteger(m.message_id) && m.message_id>0 && Number.isSafeInteger(m.date) && !m.sender_chat && !m.forward_origin && !m.via_bot && !m.edit_date && !m.business_connection_id;
export function launchURL(config, nonce) {
  if (!config?.enabled || config.launchMode!=='reply-keyboard') throw Error('disabled');
  const u=new URL(config.url);
  if(u.protocol!=='https:' || u.origin!==config.allowedOrigin || u.pathname!=='/miniapp-carousel/' || u.username || u.password || u.search || u.hash) throw Error('invalid_deploy_config');
  u.hash=new URLSearchParams({mode:'reply-keyboard',launch:nonce}).toString();return u.href;
}
function rate(g,key,now) {
  g.rates.global=g.rates.global.filter(t=>now-t<60000);
  const a=(g.rates.users[key]??[]).filter(t=>now-t<60000);g.rates.users[key]=a;
  if(now<g.cooldownUntil||g.rates.global.length>=300||a.length>=20||(a.length&&now-a.at(-1)<1100))return false;
  a.push(now);g.rates.global.push(now);return true;
}
function reject(g,u,io,reason,key) {
  init(g).events[u.update_id]={at:nowOf(io),state:'rejected',reason,...(key?{key}: {})};io.persist(g);
  return {kind:'rejected',reason,ack:true};
}
function queue(g,u,key,body,io,kind,evidence={}) {
  const e=init(g).events[u.update_id]={at:nowOf(io),key,kind,generation:GENERATION,state:'planned',body,...evidence};io.persist(g);return e;
}
function clearOwn(g,key) {
  delete init(g).sessions[key];
  for(const e of Object.values(g.miniapp.events))if(e.key===key&&e.state==='planned'){e.state='cancelled';delete e.body;}
}
async function drain(g,e,io) {
  if(e.state!=='planned')return {kind:e.state,ack:true};
  const now=nowOf(io), m=init(g), s=m.sessions[e.key];
  if(!g.optins[e.key]){e.state='cancelled';delete e.body;io.persist(g);return {kind:'cancelled',ack:true};}
  if(e.kind==='launch'&&(!s?.grant||now>=s.grant.expiresAt)){e.state='expired';delete e.body;io.persist(g);return {kind:'expired',ack:true};}
  if(io.stopping?.()||!rate(g,e.key,now)){io.persist(g);return {kind:'deferred',ack:false};}
  e.state='pending';io.persist(g); // WAL before the only possible network send.
  try {
    const r=await io.call('sendMessage',e.body);
    if(r?.chat?.id!==e.body.chat_id||!Number.isSafeInteger(r?.message_id))throw Error('ambiguous_send');
    e.state='sent';e.messageId=r.message_id;e.deliveredAt=nowOf(io);
    if(e.kind==='launch'&&s?.grant)s.grant.delivered=true;
    if(e.kind==='receipt'&&s?.receipt)s.receipt.delivery='sent';
  }catch(err){
    if(err.code===429){e.state='planned';g.cooldownUntil=now+Math.max(1000,(Number(err.retryAfter)||30)*1000);io.persist(g);return {kind:'deferred',ack:false};}
    e.state=Number.isInteger(err.code)&&err.code>=400&&err.code<500?'rejected':'unknown';
    if(e.kind==='receipt'&&s?.receipt)s.receipt.delivery=e.state;
    // Never replay uncertain sends. Lookup is a new explicit user action.
    io.failure?.(`miniapp_send_${e.state}`);
    if([401,409].includes(err.code)){delete e.body;io.persist(g);throw err;}
  }
  delete e.body;io.persist(g);return {kind:e.state,ack:true};
}
export function recover(g,io) {
  legacyRecover(g,io);
  for(const e of Object.values(init(g).events))if(e.state==='pending'){e.state='unknown';delete e.body;if(e.kind==='receipt'&&g.miniapp.sessions[e.key]?.receipt)g.miniapp.sessions[e.key].receipt.delivery='unknown';}
  io.persist(g);
}
export async function dispatch(g,u,io,config={enabled:false}) {
  if(!Number.isSafeInteger(u?.update_id)||u.update_id<0)return {kind:'skip',ack:true};
  const m=init(g), now=nowOf(io);
  if(!config.enabled)for(const e of Object.values(m.events))if(e.state==='planned'){e.state='cancelled';delete e.body;io.persist(g);}
  if(m.events[u.update_id])return drain(g,m.events[u.update_id],io);
  // Never reinterpret a legacy update already recorded, including a forged replacement body.
  if(g.events[u.update_id])return legacyDispatch(g,u,io);
  const message=u.message, command=typeof message?.text==='string'?message.text.trim():null;
  const isMini=!!message?.web_app_data || /^\/miniapp(?:_lookup|_reset|_reset_yes)?$/.test(command??'');
  if(!isMini){
    const stopped=privateSender(message)&&['/stop','STOP'].includes(command)&&message.date*1000>=now-FRESH&&message.date*1000<=now+60000;
    if(stopped){clearOwn(g,`${message.chat.id}:${message.from.id}`);io.persist(g);}
    const r=await legacyDispatch(g,u,io);
    // In this sole-owner bot, unsupported/unrelated updates are intentionally consumed.
    // Do not pin offset indefinitely behind photos, unknown messages or malformed callbacks.
    return r.kind==='unrelated'?{kind:'skip',ack:true}:r;
  }
  if(!config.enabled)return reject(g,u,io,'disabled');
  if(Object.keys(u).length!==2||!privateSender(message))return reject(g,u,io,'unbound_sender');
  const key=`${message.chat.id}:${message.from.id}`;
  if(!g.optins[key])return reject(g,u,io,'optin_required',key);
  if(g.sessions[key]?.paused)return reject(g,u,io,'handoff_paused',key);
  if(message.date*1000<now-FRESH||message.date*1000>now+60000)return reject(g,u,io,'stale_update',key);
  // Preserve the existing transport's destination check even after its session TTL expires.
  g.sessions[key]??=legacySession(message.chat.id,message.from.id,now);
  g.sessions[key].lastActive=now;
  if(Object.values(m.events).some(e=>e.key===key&&['planned','pending'].includes(e.state)))return {kind:'deferred',ack:false};
  const s=m.sessions[key]??={lastActive:now,receipt:null,grant:null};s.lastActive=now;
  const body={chat_id:message.chat.id,protect_content:true,text:''};
  let kind='reply', receiptRef=s.receipt?.id;
  if(message.web_app_data){
    if(message.text!==undefined)return reject(g,u,io,'ambiguous_message',key);
    let v;try {v=validatePayload(message.web_app_data.data,catalog,CATALOG_VERSION,now);}catch{return reject(g,u,io,'invalid_selection',key);}
    const p=v.payload, grant=s.grant;
    // button_text is untrusted and deliberately ignored. Identity is only update.from/chat.
    if(!grant||!grant.delivered||grant.hash!==hash(p.nonce)||now>=grant.expiresAt||message.date*1000<Math.floor(grant.issuedAt/1000)*1000)return reject(g,u,io,'invalid_launch',key);
    const fingerprint=hash(JSON.stringify(p));
    if(grant.consumed){
      if(grant.consumed.request===p.request&&grant.consumed.fingerprint===fingerprint){m.events[u.update_id]={at:now,key,state:'duplicate_selection'};io.persist(g);return {kind:'duplicate_selection',ack:true};}
      return reject(g,u,io,'replay_conflict',key);
    }
    grant.consumed={request:p.request,fingerprint};
    if(!s.receipt)s.receipt={id:`TEST-MINI-${randomBytes(8).toString('hex')}`,summary:canonicalSummary(v),createdAt:now,delivery:'planned'};
    body.text=`🧪 TEST受付：${s.receipt.id}\n${s.receipt.summary}\n実予約は成立していません。\n照会 /miniapp_lookup\n消去 /miniapp_reset`;
    kind='receipt';receiptRef=s.receipt.id;
  }else if(command==='/miniapp'){
    const nonce=randomBytes(16).toString('hex');let url;
    try{url=launchURL(config,nonce);}catch{return reject(g,u,io,'invalid_deploy_config',key);}
    s.grant={hash:hash(nonce),issuedAt:now,expiresAt:now+LAUNCH_TTL,delivered:false,consumed:null};
    body.text='🧪 TEST専用。下の返信キーボードから開いてください。起動は15分以内。実予約・請求なし。個人情報入力不要。';
    body.reply_markup={keyboard:[[{text:BUTTON,web_app:{url}}]],resize_keyboard:true,one_time_keyboard:true};kind='launch';
  }else if(command==='/miniapp_lookup'){
    body.text=s.receipt?`🧪 TEST受付照会：${s.receipt.id}\n${s.receipt.summary}\n前回通知：${s.receipt.delivery}\nローカルTEST記録のみ・実予約なし。`:'🧪 Mini AppのTEST受付はありません。/miniapp で開けます。';kind='lookup';
  }else if(command==='/miniapp_reset'){
    s.resetUntil=now+5*60000;body.text='自分のMini App選択・TEST受付を消しますか？5分以内に /miniapp_reset_yes 。やめる場合は /miniapp_lookup 。';
  }else if(command==='/miniapp_reset_yes'){
    if(!(s.resetUntil>now))return reject(g,u,io,'reset_confirmation_required',key);
    kind='reset';clearOwn(g,key);body.text='🧪 自分のMini App TEST記録を消去しました。実予約への影響はありません。';body.reply_markup={remove_keyboard:true};
  }
  if(command!=='/miniapp_reset'&&command!=='/miniapp_reset_yes')delete s.resetUntil;
  const e=queue(g,u,key,body,io,kind,{...(receiptRef&&['receipt','lookup','reset'].includes(kind)?{receiptHash:hash(receiptRef)}:{}),...(s.grant?{grantIssuedAt:s.grant.issuedAt}:{})});return drain(g,e,io);
}
export async function processBatch(g,updates,io,config={enabled:false}) {
  const now=nowOf(io);expire(g,now);const m=init(g);
  for(const [key,s] of Object.entries(m.sessions))if(now-s.lastActive>TTL)clearOwn(g,key);
  for(const [id,e] of Object.entries(m.events))if(now-e.at>2*TTL&&!['planned','pending'].includes(e.state))delete m.events[id];
  // Resume durable planned sends even if a caller no longer has the corresponding raw update.
  for(const e of Object.values(m.events))if(e.state==='planned'){
    if(config.enabled)await drain(g,e,io);
    else{e.state='cancelled';delete e.body;io.persist(g);}
  }
  let prefix=true, offset=g.offset, blocked=0;
  for(const u of updates){
    if(io.stopping?.())break;
    const r=await dispatch(g,u,io,config);
    if(!r.ack){prefix=false;blocked++;}
    if(prefix&&Number.isSafeInteger(u.update_id))offset=Math.max(offset??0,u.update_id+1);
  }
  g.offset=offset;g.blockedCount=blocked;io.persist(g);
  return {blocked,saturated:updates.length===100&&blocked>0};
}
