// Join verification (07 入室認証): a button press plus one simple question, answered by the person
// who asked to join. Two front ends share this state:
//   * guard bot (Bot API 10.1): ChatJoinRequest.query_id → sendChatJoinRequestWebApp opens /verify,
//     the Mini App proves who it is with signed initData, the result goes to answerChatJoinRequestQuery;
//   * fallback: a DM to user_chat_id (usable for 5 minutes) with inline buttons, result through
//     approveChatJoinRequest / declineChatJoinRequest.
import {safeEqual} from './providers/contract.mjs';

export const VERIFY_TIMEOUT_MS = 180000; // inside the 5-minute user_chat_id window
export const QUESTIONS = [
  {q: '3 + 4 は？', choices: ['5', '7', '9']},
  {q: '1週間は何日？', choices: ['5日', '7日', '10日']},
  {q: 'りんごの色として正しいのは？', choices: ['赤', '透明', '虹色']},
  {q: '「おはよう」はいつのあいさつ？', choices: ['夜', '朝', '真夜中']},
];
// Kept apart from the choices so nothing that is rendered or serialised to a client carries it.
const ANSWERS = [1, 1, 0, 1];

export function pickQuestion(rng = Math.random) {
  const i = Math.floor(rng() * QUESTIONS.length) % QUESTIONS.length;
  return {index: i, q: QUESTIONS[i].q, choices: [...QUESTIONS[i].choices]};
}
export const isCorrect = (questionIndex, choice) => Number.isInteger(choice) && ANSWERS[questionIndex] === choice;

// callback_data for the DM fallback: jv/<chatId>/b (button) or jv/<chatId>/q/<choice>
const JV = /^jv\/(-?\d{1,20})\/(b|q\/([0-9]))$/;
export function parseVerifyCallback(data) {
  const m = JV.exec(String(data ?? ''));
  if (!m) return null;
  const chatId = Number(m[1]);
  if (!Number.isSafeInteger(chatId)) return null;
  return m[2] === 'b' ? {chatId, step: 'button'} : {chatId, step: 'question', choice: Number(m[3])};
}

// Telegram Mini App initData check (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
// secret = HMAC_SHA256(key="WebAppData", msg=bot_token); hash = hex(HMAC_SHA256(key=secret, data_check_string)).
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', key, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
}
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

export async function signInitData(fields, botToken) { // used by tests to build a valid initData
  const check = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
  const secret = await hmac(new TextEncoder().encode('WebAppData'), botToken);
  const p = new URLSearchParams(fields);
  p.set('hash', hex(await hmac(secret, check)));
  return p.toString();
}

export async function checkInitData(initData, botToken, nowMs, maxAgeMs = 3600000) {
  if (!botToken || typeof initData !== 'string' || initData.length > 4096) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const check = [...p.keys()].sort().map(k => `${k}=${p.get(k)}`).join('\n');
  const secret = await hmac(new TextEncoder().encode('WebAppData'), botToken);
  if (!safeEqual(hex(await hmac(secret, check)), hash)) return null;
  const authDate = Number(p.get('auth_date')) * 1000;
  if (!Number.isFinite(authDate) || nowMs - authDate > maxAgeMs) return null;
  let user;
  try { user = JSON.parse(p.get('user') ?? 'null'); } catch { return null; }
  if (!Number.isSafeInteger(user?.id)) return null;
  return {userId: user.id, queryId: p.get('chat_join_request_query_id') ?? null};
}

// The Mini App page. No secret and no answer is embedded; the question is fetched after the button.
export function verifyPage() {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>参加前の本人確認</title><script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:var(--tg-theme-bg-color,#fff);color:var(--tg-theme-text-color,#111)}
button{display:block;width:100%;margin:10px 0;padding:14px;font-size:16px;border:0;border-radius:10px;background:var(--tg-theme-button-color,#2481cc);color:var(--tg-theme-button-text-color,#fff)}
#msg{margin-top:16px}</style></head><body><h2>参加前の本人確認</h2><p>ボタンを押して、表示される質問に答えてください（3分以内）。</p>
<div id="box"><button id="start">✅ ロボットではありません</button></div><p id="msg"></p>
<script>
const tg=window.Telegram&&Telegram.WebApp;const init=tg?tg.initData:'';const box=document.getElementById('box'),msg=document.getElementById('msg');
async function post(path,body){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({initData:init},body))});return r.json();}
document.getElementById('start').onclick=async()=>{const r=await post('/verify/start',{});if(!r.ok){msg.textContent='確認できませんでした。もう一度参加申請してください。';return;}
box.innerHTML='';const h=document.createElement('p');h.textContent=r.q;box.appendChild(h);
r.choices.forEach((c,i)=>{const b=document.createElement('button');b.textContent=c;b.onclick=async()=>{const a=await post('/verify/answer',{choice:i});box.innerHTML='';msg.textContent=a.approved?'確認できました。参加が承認されます。':'確認できませんでした。参加申請は却下されました。';setTimeout(()=>tg&&tg.close(),1500);};box.appendChild(b);});};
</script></body></html>`;
}
