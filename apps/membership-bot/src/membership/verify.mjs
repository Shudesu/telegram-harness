// Join verification (07 入室認証): a button press plus one simple question, answered by the person
// who asked to join. Two front ends share this state:
//   * guard bot (Bot API 10.1): ChatJoinRequest.query_id → sendChatJoinRequestWebApp opens /verify,
//     the Mini App proves who it is with signed initData, the result goes to answerChatJoinRequestQuery;
//   * fallback: a DM to user_chat_id (usable for 5 minutes) with inline buttons, result through
//     approveChatJoinRequest / declineChatJoinRequest.
import {TELEGRAM_SDK} from './webapp.mjs';

export const VERIFY_TIMEOUT_MS = 180000; // inside the 5-minute user_chat_id window
// How long a join request waits while its verification Mini App is queued for the owner (join_verify
// rule off). The 3-minute answer window only starts once the owner approves and the app is shown;
// a request nobody approves is declined after this. Telegram expects a guard bot's query to be
// answered quickly, so an approval this late may be refused by Telegram — turning join_verify on is
// the reliable setup.
export const VERIFY_APPROVAL_WAIT_MS = 86400000;
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

// initData is checked by the shared verifier (./webapp.mjs): the same limits as /app/.
export {signInitData} from './webapp.mjs';

// The Mini App page. No secret and no answer is embedded; the question is fetched after the button.
// The inline script runs only with the response's CSP nonce; colours follow the Telegram theme.
export function verifyPage(nonce) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>参加前の本人確認</title><script src="${TELEGRAM_SDK}"></script>
<style>:root{color-scheme:light dark;--bg:var(--tg-theme-bg-color,light-dark(#fff,#16161d));--tx:var(--tg-theme-text-color,light-dark(#15151a,#f1f1f6));--ht:var(--tg-theme-hint-color,light-dark(#7d7d8c,#9a9aab));--s2:var(--tg-theme-secondary-bg-color,light-dark(#f1f1f7,#23232d));--bt:var(--tg-theme-button-color,#2481cc);--bx:var(--tg-theme-button-text-color,#fff)}
*{box-sizing:border-box}body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:20px 16px calc(24px + env(safe-area-inset-bottom));background:var(--s2);color:var(--tx)}
.cd{padding:20px 18px;border-radius:18px;background:var(--bg)}h2{margin:0 0 6px;font-size:20px}p{margin:0 0 8px;color:var(--ht)}
button{display:block;width:100%;margin:10px 0 0;padding:14px;font:inherit;font-size:16px;font-weight:600;border:0;border-radius:12px;background:var(--bt);color:var(--bx)}button:disabled{opacity:.5}
.q{margin:4px 0 2px;color:var(--tx);font-weight:600}#msg{margin-top:14px;min-height:1.5em;color:var(--tx)}</style></head><body><div class="cd"><h2>参加前の本人確認</h2><p>ボタンを押して、表示される質問に答えてください（3分以内）。</p>
<div id="box"><button id="start">✅ ロボットではありません</button></div><p id="msg" role="status"></p></div>
<script nonce="${nonce}">
const tg=window.Telegram&&Telegram.WebApp;const init=tg?tg.initData:'';const box=document.getElementById('box'),msg=document.getElementById('msg');
function hp(k){try{k==='tap'?tg.HapticFeedback.impactOccurred('light'):tg.HapticFeedback.notificationOccurred(k)}catch(e){}}
function theme(){try{tg.setHeaderColor('secondary_bg_color');tg.setBackgroundColor('secondary_bg_color')}catch(e){}if(tg)document.documentElement.style.colorScheme=tg.colorScheme||'light'}
if(tg){tg.ready();theme();tg.onEvent('themeChanged',theme)}
async function post(path,body){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({initData:init},body))});return r.json();}
const fail=t=>{msg.textContent=t;hp('error')};
document.getElementById('start').onclick=async function(){hp('tap');this.disabled=true;let r;try{r=await post('/verify/start',{})}catch(e){r={}}if(!r.ok){this.disabled=false;fail(r.error==='unauthorized'?'有効期限が切れました。Telegram から開き直してください。':'確認できませんでした。もう一度参加申請してください。');return;}
box.innerHTML='';const h=document.createElement('p');h.className='q';h.textContent=r.q;box.appendChild(h);
r.choices.forEach((c,i)=>{const b=document.createElement('button');b.textContent=c;b.onclick=async()=>{hp('tap');box.querySelectorAll('button').forEach(x=>{x.disabled=true});let a;try{a=await post('/verify/answer',{choice:i})}catch(e){a={}}box.innerHTML='';if(a.approved){msg.textContent='確認できました。参加が承認されます。';hp('success')}else fail(a.ok?'確認できませんでした。参加申請は却下されました。':'確認できませんでした。もう一度参加申請してください。');setTimeout(()=>tg&&tg.close(),1500);};box.appendChild(b);});};
</script></body></html>`;
}
