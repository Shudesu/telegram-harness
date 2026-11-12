import {randomBytes} from 'node:crypto';
import {GENERATION,BOT,SCHEMAS,bodyHasCustomEmoji,plainBody} from './schema.mjs';
import {view,actions,transition,intent,stepsFor,menuStep,PHOTO_WARNING,REFRESH,REFRESH_NOTICE} from './menu.mjs';
export const TTL=86400000,FRESH=900000;
export function fresh(now=Date.now()){return {version:4,generation:GENERATION,createdAt:now,optins:{},sessions:{},events:{},offset:null,fileIds:{},polls:0,callbacks:0,receipts:0,completed:0,starts:0,attempts:0,sent:0,unknown:0,rates:{global:[],users:{}},cooldownUntil:0,deferUntil:0};}
export function migrate(old,now=Date.now()){
 if(old.generation===GENERATION)return old;
 const g=fresh(now);g.optins=old.optins??{};g.events=old.events??{};g.offset=old.offset??null;g.previousGeneration={generation:old.generation,sent:old.sent??0,unknown:old.unknown??0};return g;
}
export function session(chatId,userId,now=Date.now()){return {chatId,userId,session:randomBytes(8).toString('hex'),rev:0,page:'industries',header:null,industry:null,service:null,staff:null,slot:null,receipt:null,messageId:null,stack:[],paused:false,handoff:null,lastActive:now,photosSeen:[],completed:false};}
export function expire(g,now){for(const [k,s] of Object.entries(g.sessions))if(now-s.lastActive>TTL&&!Object.values(g.events).some(e=>e.key===k&&e.state==='processing'))delete g.sessions[k];for(const [id,e] of Object.entries(g.events))if(now-e.at>2*TTL&&!['processing','pending'].includes(e.state))delete g.events[id];for(const [k,a] of Object.entries(g.rates.users))if(!a.some(t=>now-t<60000))delete g.rates.users[k];}
function privateMessage(m){return m?.chat?.type==='private'&&Number.isSafeInteger(m.from?.id)&&m.from.id>0&&m.from.is_bot===false&&m.chat.id===m.from.id&&!m.sender_chat&&!m.forward_origin&&!m.via_bot&&!m.edit_date&&typeof m.text==='string'&&Number.isSafeInteger(m.date);}
export function classify(g,u,now=Date.now()){
 if(!Number.isSafeInteger(u?.update_id)||Object.keys(u).length!==2)return {kind:'unrelated'};
 if(g.events[u.update_id])return {kind:g.events[u.update_id].state==='processing'?'continue':'duplicate',ack:g.events[u.update_id].state!=='processing'};
 let s,action,key,start=false,cb=u.callback_query,m=u.message;
 if(m){
  if(!privateMessage(m))return {kind:'unrelated'};
  key=`${m.chat.id}:${m.from.id}`;const text=m.text.trim();start=/^\/start(?:@teleharness_bot)?(?:\s+test_booking)?$/.test(text);
  if(!start&&!g.optins[key])return {kind:'unrelated'};
  if(m.date*1000<now-FRESH||m.date*1000>now+60000)return {kind:'discard',reason:'stale_test_event',ack:true};
  if(text==='/stop'||text==='STOP')return {kind:'stop_request',key,ack:true};
  s=g.sessions[key]??session(m.chat.id,m.from.id,now);
  action=start?'home':intent(text,s);
  if(s.paused&&!['resume','review','reset','reset_yes'].includes(action))return {kind:'discard',reason:'human_pause',ack:true};
 }else if(cb){
  m=cb.message;
  if(cb.from?.is_bot!==false||m?.chat?.type!=='private'||cb.from?.id!==m.chat.id||m.from?.id!==BOT||!m.date||cb.inline_message_id||typeof cb.id!=='string'||typeof cb.data!=='string')return {kind:'unrelated'};
  key=`${m.chat.id}:${cb.from.id}`;if(!g.optins[key])return {kind:'unrelated'};
  // A press on a message the session has moved past — a newer menu was sent, the chat was paged on,
  // the journal came back under a new generation, the 24h session expired — must not dead-end.
  // The press still performs its own action whenever the screen in front of the user offers it;
  // otherwise it simply asks for that screen again. Identity, opt-in and dedup checks are unchanged.
  s=g.sessions[key]??session(m.chat.id,cb.from.id,now);
  const parts=cb.data.split(':');action=parts.length>=3?parts.slice(2).join(':'):REFRESH;
  if(!actions(s).includes(action))action=REFRESH;
 }else return {kind:'unrelated'};
 if(Object.values(g.events).some(e=>e.key===key&&e.state==='processing'))return {kind:'deferred',ack:false};
 const n=transition(s,action);n.lastActive=now;n.messageId=null;
 return {kind:'render',session:n,key,callbackId:cb?.id,action,start,messageAt:m.date*1000};
}
// Spacing between outbound messages. Telegram asks for about one message a second in a single chat
// and says short bursts over that are tolerated; what keeps the sustained rate honest is the rolling
// 20-per-user cap below, which is 0.33/s on average and is unchanged, as are the 300-global cap and
// the 429 cooldown. So the gap between two presses only has to be short enough that a person tapping
// at a normal pace never waits on us, and the two or three messages inside ONE press are a burst
// that only has to stay in order.
export const USER_GAP=600,BURST_GAP=150;
// 0 = send now, >0 = wait that many ms first, -1 = give the slot up (cooldown or a rolling cap).
function rateDelay(g,key,now,burst){
 g.rates.global=g.rates.global.filter(t=>now-t<60000);const a=(g.rates.users[key]??[]).filter(t=>now-t<60000);g.rates.users[key]=a;
 if(now<g.cooldownUntil){g.deferUntil=g.cooldownUntil;return -1;}
 if(g.rates.global.length>=300||a.length>=20){g.deferUntil=Math.min(g.rates.global.length>=300?g.rates.global[0]:Infinity,a.length>=20?a[0]:Infinity)+60000;return -1;}
 const gap=burst?BURST_GAP:USER_GAP,since=a.length?now-a.at(-1):Infinity;
 return since<gap?gap-since:0;
}
function reserveRate(g,key,now){(g.rates.users[key]??=[]).push(now);g.rates.global.push(now);g.deferUntil=0;}
// No timer is imported here: the caller supplies the wait, so the suite advances its own clock
// instead of sleeping and the poller can cancel the wait on SIGTERM.
const hold=(io,ms)=>io.wait?io.wait(ms):new Promise(r=>setTimeout(r,ms));
// Only ids recorded for assets the engine can still name stay usable; the rest are dropped so a
// retired file's id can never be passed back to Telegram after the asset itself changed format.
export function pruneFileIds(g,allowed=[]){for(const k of Object.keys(g.fileIds??{}))if(!allowed.includes(k))delete g.fileIds[k];return g;}
export function recover(g,io){for(const e of Object.values(g.events)){if(e.state==='pending'){e.state='unknown';g.unknown++;}for(const step of e.steps??[])if(step.state==='pending'){step.state='unknown';g.unknown++;io.failure?.('interrupted_action_quarantined');}}io.persist(g);}
async function ackCallback(io,id,text){if(!id)return;try{await io.call('answerCallbackQuery',{callback_query_id:id,...(text?{text}: {})});}catch{io.failure?.('callback_answer_failed');}}
export async function dispatch(g,u,io){
 const now=io.now?.()??Date.now();const d=classify(g,u,now);
 // The spinner on the pressed button is cleared first and in parallel. It used to be awaited before
 // the first send, which put a whole round trip (~230 ms to api.telegram.org from this machine) in
 // front of every reply for an acknowledgement that carries no content of its own.
 let ack=null;const done=async r=>{if(ack)await ack;return r;};
 if(['unrelated','duplicate','deferred'].includes(d.kind))return d;
 if(d.kind==='discard'){g.events[u.update_id]={at:now,state:d.reason};io.persist(g);await ackCallback(io,d.callbackId);return d;}
 if(d.kind==='stop_request'){
  // No inherited USER-live identity is an administrator. Whole-service stop is local stop.py only.
  for(const e of Object.values(g.events))if(e.key===d.key&&e.state==='processing')e.state='session_stopped';
  delete g.sessions[d.key];delete g.optins[d.key];if(g.lastReceiptIds)delete g.lastReceiptIds[d.key];g.events[u.update_id]={at:now,state:'user_stop'};io.persist(g);return {kind:'user_stop',ack:true};
 }
 let e=g.events[u.update_id];
 if(d.kind==='render'){
  if(d.start)g.optins[d.key]={since:g.optins[d.key]?.since??now,lastStartAt:d.messageAt};
  g.sessions[d.key]=d.session;
  e={at:now,state:'processing',key:d.key,action:d.action,start:d.start,callbackId:d.callbackId,callbackAcked:!!d.callbackId,steps:stepsFor(d.session,d.action,d.start,g.fileIds??={}).map(x=>({...x,state:'planned'})),receiptWasNew:d.action==='confirm'&&d.session.receipt?.id!==g.lastReceiptIds?.[d.key]};
  // Generated fixed copy only is journaled, never incoming user text. One write covers the plan and
  // the acknowledgement attempt, so the press pays a single journal round before anything goes out.
  g.events[u.update_id]=e;io.persist(g);
  ack=ackCallback(io,e.callbackId,e.action===REFRESH?REFRESH_NOTICE:undefined);
 }
 const s=g.sessions[e.key];if(!s||!g.optins[e.key]){e.state='session_stopped';io.persist(g);return done({kind:'handled',ack:true});}
 for(const step of e.steps){
  if(step.state!=='planned')continue;
  if(io.stopping?.())return done({kind:'deferred',ack:false});
  // Wait the spacing out in place instead of handing a half-finished press back to the poller: the
  // old path paid a 1.2 s poll pause plus a getUpdates round trip for every message after the first.
  const delay=rateDelay(g,e.key,io.now?.()??Date.now(),e.steps.some(x=>x.state==='sent'));
  if(delay<0){io.persist(g);return done({kind:'deferred',ack:false});}
  if(delay>0){await hold(io,delay);if(io.stopping?.())return done({kind:'deferred',ack:false});}
  reserveRate(g,e.key,io.now?.()??Date.now());
  if(step.menu&&e.steps.some(x=>x.method==='sendPhoto'&&['unknown','rejected'].includes(x.state))){
   const field=step.method==='sendAnimation'?'caption':'text',warn=`\n\n⚠️ <i>${PHOTO_WARNING}。同じ送信は自動再実行しません。必要なら「🖼 顔写真」を選んでください。</i>`;
   if(!step.body[field].includes(PHOTO_WARNING))step.body[field]+=warn;
  }
  // Once a plain retry has proved Telegram refuses our custom emoji (the owner's Premium
  // subscription is the gate), every later message goes out without the markup from the start.
  // The markup lives in three places now: the caption/text, and each button's icon_custom_emoji_id.
  if(g.customEmojiDisabled)step.body=plainBody(step.body);
  step.state='pending';g.attempts++;io.persist(g);
  try{
   const r=await io.call(step.method,step.body);
   if(r?.chat?.id!==s.chatId||!Number.isSafeInteger(r.message_id))throw Error('ambiguous');
   if(step.method==='sendPhoto'&&(!Array.isArray(r.photo)||!r.photo.length))throw Error('photo_not_confirmed');
   if(step.method==='sendAnimation'&&!r.animation)throw Error('animation_not_confirmed');
   step.state='sent';step.messageId=r.message_id;g.sent++;
   const photos=e.steps.filter(x=>x.method==='sendPhoto');if(photos.length&&photos.every(x=>x.state==='sent')&&!s.photosSeen.includes(s.industry))s.photosSeen.push(s.industry);
   if(step.method==='sendPhoto'){io.event?.('photo_sent',{industry:s.industry});
    // Same trade the headers already made: the collage bytes travel once and later presses pass the
    // id back, which is what keeps a face screen off the external volume and off the upload path.
    if(step.asset){const id=r.photo?.at(-1)?.file_id;if(typeof id==='string')(g.fileIds??={})[step.asset]=id;}}
   // The probe is the same copy minus the <tg-emoji> wrappers: if it lands where the original was
   // refused, custom emoji are the cause, so stop emitting them instead of paying 400s forever.
   if(step.customEmojiProbe)g.customEmojiDisabled=true;
   if(step.method==='sendAnimation'){io.event?.('animation_sent',{});
    // Only ids Telegram returned for assets this bot uploaded are cached, and the handler re-checks them.
    if(step.asset&&typeof r.animation?.file_id==='string')(g.fileIds??={})[step.asset]=r.animation.file_id;}
   // Only the menu message binds callbacks and counts; a leading bottom-keyboard message must not double count.
   if(step.menu){
    s.messageId=r.message_id;if(e.callbackId)g.callbacks++;if(e.start)g.starts++;
    if(e.action==='confirm'&&s.receipt&&e.receiptWasNew){g.lastReceiptIds??={};g.lastReceiptIds[e.key]=s.receipt.id;g.receipts++;io.event?.('receipt',{receipt:s.receipt.id,photoConfirmed:s.photosSeen.includes(s.receipt.industry)});}
    if(e.action==='lookup'&&s.receipt&&!s.receipt.cancelled&&g.lastReceiptIds?.[e.key]===s.receipt.id&&s.photosSeen.includes(s.receipt.industry)){g.completed++;io.event?.('E2E',{receipt:s.receipt.id,photoConfirmed:true});}
   }
   io.persist(g);
  }catch(err){
   if(err.code===429){step.state='planned';g.cooldownUntil=(io.now?.()??Date.now())+Math.max(1000,(err.retryAfter??30)*1000);g.deferUntil=g.cooldownUntil;io.persist(g);return done({kind:'deferred',ack:false});}
   step.state=err.code>=400&&err.code<500?'rejected':'unknown';if(step.state==='unknown')g.unknown++;io.failure?.(`outbound_${step.state}_action_quarantined`);
   if(err.code===400&&!step.customEmojiProbe&&bodyHasCustomEmoji(step.body)){
    // A 400 is proof nothing was delivered, so the identical wording is queued once more with the
    // <tg-emoji> wrappers removed and every button icon folded back into its label; the fallback
    // glyph is already in the tag and in EMOJI_BY_ID, so nothing else moves.
    e.steps.push({...step,body:plainBody(step.body),state:'planned',customEmojiProbe:true});
    io.failure?.('custom_emoji_rejected_resent_plain');
   }
   else if(step.state==='rejected'&&['sendAnimation','sendPhoto'].includes(step.method)){
    // A 4xx is proof nothing was delivered, so a stale cached file_id is dropped and, if this was the
    // menu itself, a plain-text menu is appended. An 'unknown' outcome is never retried this way.
    if(step.asset&&g.fileIds?.[step.asset])delete g.fileIds[step.asset];
    if(step.menu&&!e.steps.some(x=>x.menu&&x.method==='sendMessage'))e.steps.push({...menuStep({...s,header:null}),state:'planned'});
   }
   io.persist(g);
   if([401,409].includes(err.code))throw err;
  }
 }
 e.state=e.steps.some(x=>x.state==='unknown')?'quarantined':e.steps.some(x=>x.state==='rejected')?'rejected':'sent';
 // Release bulky fixed message bodies once all actions are resolved; retain exact per-action dispositions.
 e.steps=e.steps.map(({method,state,messageId,menu,asset,customEmojiProbe})=>({method,state,messageId,...(menu?{menu}:{}),...(asset?{asset}:{}),...(customEmojiProbe?{customEmojiProbe}:{})}));io.persist(g);
 return done({kind:'handled',ack:true});
}
export async function processBatch(g,updates,io){expire(g,io.now?.()??Date.now());let prefix=true,offset=g.offset;g.blockedCount=0;for(const u of updates){if(io.stopping?.())break;const d=await dispatch(g,u,io);if(!d.ack){prefix=false;g.blockedCount++;}if(prefix)offset=u.update_id+1;}g.offset=offset;io.persist(g);return {blocked:g.blockedCount,saturated:updates.length===100&&g.blockedCount>0};}
