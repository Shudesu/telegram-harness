import {SCHEMAS,NOTICE,HEADERS,SHOWCASE,CUSTOM_EMOJI,selection,slotText,slotLabel,esc,plain,ce} from './schema.mjs';
export {BOT,INDUSTRIES} from './schema.mjs';
// Bottom (custom reply) keyboard shown under the input field. Official ReplyKeyboardMarkup fields only:
// keyboard / is_persistent / resize_keyboard / one_time_keyboard / input_field_placeholder / selective.
// is_persistent:true keeps it visible, so it is attached once on /start (and on /keyboard) instead of every turn.
// one_time_keyboard is left false on purpose: these are permanent entry points, not a one-shot prompt.
// A message carries exactly one reply_markup and the message-editing methods take inline markup only,
// so the bottom keyboard rides on its own leading sendMessage, never on the rich header message.
// The three labels are unchanged (they are also the text the user sends back, and intent() keys on it);
// the booking entry point additionally carries the official style field so it reads as the main one.
export const KEYBOARD_BUTTONS=['👤 会員','🎨 メッセージ作成','📅 予約デモ'];
export const KEYBOARD_TEXT='入力欄の下にボタンを3つ出しました。『👤 会員』『🎨 メッセージ作成』『📅 予約デモ』。説明は /keyboard 、外す場合は /keyboard_off 。';
export const KEYBOARD_OFF_TEXT='入力欄の下のボタンを外しました。出し直しは /keyboard 。';
export const replyKeyboard=()=>({keyboard:[KEYBOARD_BUTTONS.map(text=>({text,...(text==='📅 予約デモ'?{style:'primary'}:{})}))],is_persistent:true,resize_keyboard:true,one_time_keyboard:false,input_field_placeholder:'下のボタン、または「予約したいです」'});

// Telegram limits: 1024 visible characters for a media caption, 4096 for a plain message.
export const CAPTION_LIMIT=1024,TEXT_LIMIT=4096;
// Layout rule for every screen, replacing the old one-column/at-most-four rule: the choices are laid
// out as a two- or three-across grid of short labels, and the row underneath is a single full-width
// button for the one thing the screen is actually for. Ten buttons is the ceiling for one screen.
export const MAX_BUTTONS=10,LABEL_MAX=12;
// Column count follows the number of choices so the grid never ends in a lonely one-button row
// that would be mistaken for the full-width action below it.
export const columns=n=>n<=1?1:n%3===0?3:n%2===0?2:3;
// Internal action for a press on a message the session has already moved past. No button carries it:
// it is substituted in when the pressed action is not on the screen the session is actually showing,
// so an old button re-sends the current menu instead of answering that it expired.
export const REFRESH='__refresh';
export const REFRESH_NOTICE='最新のメニューを出し直しました';
export const PHOTO_WARNING='一部の顔写真は送信結果を確認できませんでした';

const b=t=>`<b>${esc(t)}</b>`,i=t=>`<i>${esc(t)}</i>`;
// Animated headline: escape first, then upgrade the glyphs we own to our own custom emoji.
// Only two lines per screen get this — the headline and the call to action directly above the
// buttons — so the motion marks the two places the eye already goes, instead of the whole body.
const anim=t=>esc(t).replace(/\p{Extended_Pictographic}/gu,ce);
const bA=t=>`<b>${anim(t)}</b>`;
const RULE='━━━━━━━━━━';
// Every body is built as: bold headline with one meaningful emoji, the disclosure line, a rule,
// short emoji-led bullets, then the bold call to action. The reference layout, none of its content.
// `accent` is the animated glyph that closes the call-to-action line; false drops that line entirely.
const card=(head,lines,accent='⭐')=>[bA(head),i(NOTICE),RULE,...lines.filter(Boolean),...(accent?['',bA(`👇 選んでください ${accent}`)]:[])].join('\n');
const money=n=>n.toLocaleString('ja-JP');
// selection() is stored plain (it also becomes a receipt summary), so it is escaped at render time.
const selLines=s=>selection(s).split('\n').map((line,n)=>`${['🏷','🛎','👤','🕒','💴'][n]??'•'} ${esc(line)}`);

// A label may open with one emoji. If that glyph is one of the eight this bot published as a custom
// emoji, it moves out of the text into the official icon_custom_emoji_id field, where Telegram draws
// it animated in front of a shorter label; otherwise it simply stays in the text. Only official
// InlineKeyboardButton fields are ever emitted, and never a url/web_app/request_* one.
const LEAD=/^(\p{Extended_Pictographic}️?) (.+)$/u;
function button(text,action,s,style){
 const m=LEAD.exec(text),id=m&&CUSTOM_EMOJI[m[1]];
 const label=id?m[2]:text;
 if([...label].length>LABEL_MAX)throw Error('label_too_long');
 return {text:label,...(id?{icon_custom_emoji_id:id}:{}),...(style?{style}:{}),callback_data:`${s.session}:${s.rev}:${action}`};
}

export function view(s){
 // `cells` is the grid of choices, `main` the single full-width button that closes every screen.
 const cells=[];let main=null,body='';
 const add=(text,action,style)=>cells.push([text,action,style]);
 const bottom=(text,action,style)=>{main=[text,action,style];};
 const c=SCHEMAS[s.industry];
 if(s.paused&&s.page!=='reset'){
  body=card('⏸ ハンドオフ・シミュレーション中',[
   ...esc(s.handoff?.summary??selection(s)).split('\n').map(x=>`• ${x}`),
   `🔀 引継ぎ先：${s.handoff?.type==='agent'?'agenticフォローの模擬':'人間担当の模擬'}`,
   '🚫 実担当者への送信・接続はありません',
   '💤 自動応答は停止中です（「再開」で戻れます）'],'👤');
  add('📋 選択内容','review');add('🧹 リセット','reset','danger');
  bottom('▶️ Botを再開','resume','primary');
 }
 else switch(s.page){
 case 'industries':
  body=card('📅 予約デモ ⭐',[
   `🏷 ${SCHEMAS.length}業態の受付デモから1つ選べます`,
   '🎭 スタッフ・料金・空き枠はすべて架空です',
   '💬 「予約したいです」「料金は？」と入力もできます'],'📅');
  // All nine fit one three-across grid now that the labels are short, so there is no paging left.
  SCHEMAS.forEach((x,n)=>add(x.short,`i${n}`));
  bottom('ℹ️ 使い方','help');break;
 case 'overview':
  body=card(`🏷 ${c.label} 🔥`,[
   ...selLines(s),
   '👥 顔写真はAI生成の架空成人・複数業態共通のデモ人物です',
   '💬 「予約したいです」「営業時間は？」も入力できます'],'🔥');
  add('❓ 質問','faq');add('🖼 顔写真','staff_cards');add('🔄 業態切替','home');
  bottom('📅 予約する','book','primary');break;
 case 'services':
  body=card('🛎 サービスを選ぶ 💎',[
   `🏷 ${esc(c.label)}`,
   ...c.services.map(x=>`💴 ${esc(x.name)}　${x.minutes}分／${money(x.yen)}円`),
   '🚫 サンプル見積のみ・実請求はありません'],'💎');
  c.services.forEach((x,n)=>add(x.brief,`v${n}`));
  bottom('↩️ 戻る','back');break;
 case 'staff':
  body=card('👤 架空スタッフを選ぶ',[
   `🏷 ${esc(c.label)}`,
   `🧑 ${esc(c.staff.map(x=>`${x.name}（${x.age}歳設定）`).join('／'))}`,
   '🖼 顔は1枚の横長カードにまとめて出します',
   `🗓 共通ダミーシフト：${esc(c.shift)}`],'👤');
  c.staff.forEach((x,n)=>add(x.name,`p${n}`));
  add('🖼 顔写真','staff_cards');
  bottom('↩️ 戻る','back');break;
 case 'slots':
  body=card('🕒 枠を選ぶ 📅',[...selLines(s),'📌 固定の2026年ダミー枠です。空き状況は照会していません'],'📅');
  c.slots.forEach((x,n)=>add(slotLabel(c,n),`s${n}`));
  bottom('↩️ 戻る','back');break;
 case 'confirm':
  body=s.receipt&&!s.receipt.cancelled
   ?card('🧾 既存のTEST受付があります',[`🆔 ${esc(s.receipt.id)}`,...esc(s.receipt.summary).split('\n').map(x=>`• ${x}`),'♻️ 確定しても重複作成せず既存受付を表示します','🗑 内容を変える場合は先に既存受付を取り消してください'],'🎉')
   :card('✅ 内容の確認 ⭐',[...selLines(s),'🚫 実予約は成立しません（TEST記録のみ）','💬 「TEST確認」と入力しても確定できます'],'⭐');
  add('🕒 枠を変更','slots');add('↩️ 戻る','back');
  bottom('✅ TEST確定','confirm','success');break;
 case 'receipt':
  body=s.receipt
   ?card('🧾 TEST受付 🎉',[`🆔 ${esc(s.receipt.id)}`,...esc(s.receipt.summary).split('\n').map(x=>`• ${x}`),`📍 状態：${s.receipt.cancelled?'取消済み':'ローカルTEST記録のみ'}`,'🚫 実予約は成立していません'],'🎉')
   :card('🧾 TEST受付',['📭 TEST受付はまだありません','📅 「予約デモ」から作成できます'],'📅');
  add('🔄 再照会','lookup');add('🗑 取消','cancel','danger');add('👥 引継ぎ','handoff');
  bottom('🏠 ホーム','home');break;
 case 'review':
  body=card('📋 選択内容 💎',[
   ...selLines(s),
   `🧾 ${s.receipt?'TEST受付：'+esc(s.receipt.id)+(s.receipt.cancelled?'（取消済み）':''):'TEST受付なし'}`,
   s.handoff?'🔀 引継ぎ要約は保持されています（シミュレーション）':''],'💎');
  add('📅 予約デモ','book');add('🧾 TEST受付','receipt');
  bottom('🏠 ホーム','home');break;
 case 'cancel':
  body=card('🗑 取消の確認',['❓ 自分のTEST受付だけを取り消しますか？','🚫 実予約・取消料はありません'],'⭐');
  add('🗑 取り消す','cancel_yes','danger');add('↩️ 戻る','back');
  bottom('🏠 ホーム','home');break;
 case 'cancelled':
  body=card('🗑 取消しました',['✅ 自分のTEST受付を取り消しました','🚫 実予約・請求への影響はありません'],'📅');
  add('📅 再予約','book');add('🧾 TEST受付','receipt');
  bottom('🏠 ホーム','home');break;
 case 'faq':
  body=card('❓ よくある質問',[
   `🏷 ${esc(c.label)}`,
   s.faqKey?`💡 ${esc(c.faq[s.faqKey])}`:'💡 下のボタンを押すか、質問を入力してください',
   '💬 「サービス内容」「キャンセル料」も入力で答えます'],'💎');
  add('💴 料金','f_price');add('🕒 営業時間','f_hours');add('🛡 安全性','f_safety');
  bottom('↩️ 戻る','back');break;
 case 'consult':
  body=card('💬 ご相談',[
   `🏷 ${esc(c.label)}`,
   `💡 ${esc(c.faq.service)}`,
   '🤖 固定ルールのintent/FAQデモです。一般LLM・自律実務agentではありません',
   '🔒 個人情報は入力しないでください'],'💎');
  add('👥 引継ぎ','handoff');add('❓ 質問','faq');
  bottom('↩️ 戻る','back');break;
 case 'handoff':
  body=card('👥 引継ぎ前の確認',[...selLines(s),`🧾 TEST受付：${esc(s.receipt?.id??'なし')}`,'🚫 検証済みの担当者経路がないためシミュレーションです','📴 外部へは送信しません'],'👤');
  add('🧑 人へ模擬','human');add('🤖 agent模擬','agent');
  bottom('↩️ 戻る','back');break;
 case 'member':
  body=card('👤 会員ステータス ⭐',[
   '🔌 会員APIサーバは未デプロイ・未接続：登録・課金・入室承認はできません',
   '💳 実決済レールは1本も接続していません（金額は出しません）',
   '⏳ 期限切れ後の挙動・自動退出は未観測です',
   '👀 公開されているのは閲覧用の試作だけです',
   '🏠 入力欄の左のメニューボタンから表示のみ開けます'],'👤');
  add('📅 予約デモ','book');add('🎨 メッセージ作成','compose');
  bottom('🏠 ホーム','home');break;
 case 'compose':
  body=card('🎨 メッセージ作成 🔥',[
   '📴 このトークからの実送信・一斉配信の経路はありません',
   '📝 下書きは開いた端末のブラウザ内だけに残り、誰にも届きません',
   '🎞 上の動画ヘッダー（MP4・2048×800）がこのBotの実物です',
   '🖼 編集画面そのものは閲覧用の試作だけです'],'🎨');
  if(c)add('🎞 動く装飾','animate');
  add('👤 会員','member');add('📅 予約デモ','book');
  bottom('🏠 ホーム','home');break;
 case 'keyboard':
  body=card('⌨️ 入力欄の下のボタン',[
   '👤 会員＝会員機能の現状（TEST・未接続）',
   '🎨 メッセージ作成＝制作機能の現状（TEST・実送信なし）',
   '📅 予約デモ＝このトーク内の予約TESTデモ',
   '🚫 どれを押しても実予約・実課金・実送信・一斉配信はありません',
   '🧹 外す場合は /keyboard_off'],'⭐');
  bottom('🏠 ホーム','home');break;
 case 'keyboard_off':
  body=card('⌨️ ボタンを外しました',[
   '💬 文字入力（「予約したいです」など）はそのまま使えます',
   '🔘 メッセージ内のボタンもそのまま使えます',
   '🔁 出し直しは /keyboard'],'⭐');
  bottom('🏠 ホーム','home');break;
 case 'reset':
  body=card('🧹 リセットの確認',['❓ 自分の選択・TEST受付・引継ぎ要約を消去しますか？','🚫 他の人の記録には触れません'],'⭐');
  add('🧹 消去する','reset_yes','danger');add('↩️ 戻る','back');
  bottom('🏠 ホーム','home');break;
 case 'help':
  body=card('ℹ️ 使い方',[
   '💬 入力例：「予約したいです」「料金は？」「営業時間は？」「予約確認」',
   '💬 「相談したい」「人につないで」「戻る」「業態切替」「リセット」',
   '🤖 固定の日本語・英語intent/FAQで応答します。一般LLMではありません',
   '⏳ 古いボタンを押すと最新のメニューを出し直します（選択は24時間で期限切れ）',
   '🛑 /stop または STOP で自分のセッションだけ停止、再開は /start'],'⭐');
  add('📅 予約デモ','book');add('⌨️ ボタン','keyboard');
  bottom('🏠 ホーム','home');break;
 case 'animation':
  body=card('🎞 動く装飾 🎉',['✨ 上の動画ヘッダーは自前生成のオリジナル（H.264）です','🎨 行頭と「選んでください」の絵文字も自作の動くカスタム絵文字です','🚫 自動配信はしません。押したときだけ送ります'],'🎉');
  add('🎨 メッセージ作成','compose');add('👤 会員','member');
  bottom('🏠 ホーム','home');break;
 default:throw Error('invalid_page');
 }
 const cols=columns(cells.length),rows=[];
 for(let n=0;n<cells.length;n+=cols)rows.push(cells.slice(n,n+cols).map(x=>button(x[0],x[1],s,x[2])));
 if(main)rows.push([button(main[0],main[1],s,main[2])]);
 if(rows.flat().length>MAX_BUTTONS)throw Error('too_many_buttons');
 if(!rows.length)throw Error('no_buttons');
 return {text:body,plain:plain(body),reply_markup:{inline_keyboard:rows}};
}
export function actions(s){return view(s).reply_markup.inline_keyboard.flat().map(x=>x.callback_data.split(':')[2]);}
const direct={'/menu':'home','/start':'home','/home':'home','ホーム':'home','メニュー':'home','/industry':'home','業種切替':'home','業態切替':'home','切替':'home','ほかの業態':'home','/book':'book','booking':'book','/booking':'receipt','/review':'review','review':'review','確認':'review','選択内容':'review','予約確認':'receipt','/help':'help','ヘルプ':'help','/reset':'reset','reset':'reset','リセット':'reset','/back':'back','back':'back','戻る':'back','/cancel':'cancel','cancel':'cancel','/consult':'consult','consult':'consult','/handoff':'handoff','handoff':'handoff','/pause':'human','/resume':'resume','resume':'resume','再開':'resume','test確認':'confirm','test確定':'confirm','/confirm':'confirm','faq':'faq','/faq':'faq','人につないで':'handoff','👤 会員':'member','会員':'member','/member':'member','🎨 メッセージ作成':'compose','メッセージ作成':'compose','/compose':'compose','📅 予約デモ':'book','予約デモ':'book','/keyboard':'keyboard','キーボード':'keyboard','/keyboard_off':'keyboard_off'};
export function intent(text,s){
 const t=text.trim().toLowerCase().normalize('NFKC');if(t.length>300)return 'help';
 if(direct[t])return direct[t];
 const i=SCHEMAS.findIndex(x=>[x.id,x.label,x.short].includes(t));if(i>=0)return `i${i}`;
 if(/^(予約|申し込み|申込)(を)?(したい|したいです|お願い(します)?|する)?[。！!？?]?$/.test(t)||t==='book')return 'book';
 if(/^(予約|test受付)?(の)?(キャンセル|取消|取り消し)(したい|したいです|をしたいです)?[。？?]?$/.test(t))return 'cancel';
 if(/^(人間|担当者|スタッフ)(に|へ)?(つないで|お願いします|お願い|引継ぎ|引き継ぎ)[。！!]?/.test(t))return 'handoff';
 if(/^(相談)(したい|したいです|する|お願いします)?[。？?]?$/.test(t))return 'consult';
 if(/^(料金|価格|値段|見積|いくら|price)/.test(t))return 'f_price';
 if(/^(営業|何時|シフト|hours)/.test(t))return 'f_hours';
 if(/^(どんなサービス|サービス内容|service)/.test(t))return 'f_service';
 if(/^(本物|実在|年齢|安全|safety)/.test(t))return 'f_safety';
 if(/^(キャンセル料|取消料)/.test(t))return 'f_cancel';
 const c=SCHEMAS[s.industry];if(c){
  const p=c.staff.findIndex(x=>t===x.name.toLowerCase());if(p>=0)return `p${p}`;
  const v=c.services.findIndex(x=>[x.name,x.brief].includes(t));if(v>=0)return `v${v}`;
  if(/^[12]$/.test(t)){const n=Number(t)-1;if(s.page==='services')return `v${n}`;if(s.page==='staff'&&c.staff[n])return `p${n}`;if(s.page==='slots')return `s${n}`;}
 }
 return 'help';
}
export function transition(s,action){
 const n=structuredClone(s);n.rev++;n.faqKey=null;
 if(n.paused&&!['resume','review','reset','reset_yes'].includes(action))return n;
 const go=page=>{if(n.page!==page)n.stack.push(n.page);n.stack=n.stack.slice(-16);n.page=page;};
 const c=SCHEMAS[n.industry];
 // Re-sending the current screen changes nothing but the revision, so the FAQ answer in view survives.
 if(action===REFRESH){n.faqKey=s.faqKey??null;}
 else if(action==='reset_yes'){Object.assign(n,{industry:null,service:null,staff:null,slot:null,receipt:null,paused:false,handoff:null,page:'industries',stack:[],photosSeen:[],completed:false});}
 else if(action==='home'){n.page='industries';n.stack=[];}
 else if(action==='back'){n.page=n.stack.pop()??(c?'overview':'industries');}
 else if(action==='resume'){n.paused=false;n.page=c?'overview':'industries';}
 else if(/^i[0-8]$/.test(action)){n.industry=Number(action.slice(1));n.service=null;n.staff=null;n.slot=null;n.page='overview';n.stack=[];}
 else if(['help','reset','review','member','compose','keyboard','keyboard_off'].includes(action))go(action);
 else if(!c){n.page='industries';}
 else if(action==='book'){go('services');}
 else if(action==='staff_cards'){go('staff');}
 else if(action==='slots'){go(n.service===null?'services':n.staff===null?'staff':'slots');}
 else if(/^v[01]$/.test(action)){n.service=Number(action.slice(1));n.slot=null;go('staff');}
 else if(/^p[01]$/.test(action)&&c.staff[Number(action.slice(1))]){n.staff=Number(action.slice(1));n.slot=null;go(n.service===null?'services':'slots');}
 else if(/^s[01]$/.test(action)){if(n.service===null||n.staff===null)go('services');else{n.slot=Number(action.slice(1));go('confirm');}}
 else if(action==='confirm'){if(n.service===null||n.staff===null||n.slot===null)go('services');else{if(!n.receipt||n.receipt.cancelled)n.receipt={id:`TEST-${n.session}-${n.rev}`,summary:selection(n),cancelled:false,industry:n.industry,service:n.service,staff:n.staff,slot:n.slot};go('receipt');}}
 else if(action==='lookup'||action==='receipt'){go('receipt');if(action==='lookup'&&n.receipt&&!n.receipt.cancelled)n.completed=true;}
 else if(action==='cancel_yes'){if(n.receipt)n.receipt.cancelled=true;go('cancelled');}
 else if(action==='human'||action==='agent'){n.handoff={type:action,summary:selection(n)+'\nTEST受付：'+(n.receipt?.id??'なし')};n.paused=true;go('handoff');}
 else if(action==='animate')go('animation');
 else if(action.startsWith('f_')&&c.faq[action.slice(2)]){n.faqKey=action.slice(2);go('faq');}
 else if(['faq','consult','handoff','cancel'].includes(action))go(action);
 else go('help');
 if(!SCHEMAS[n.industry]&&!['industries','help','reset','review','member','compose','keyboard','keyboard_off'].includes(n.page))n.page='industries';
 if(n.page==='confirm'&&(n.service===null||n.staff===null||n.slot===null))n.page='services';
 if(n.page==='slots'&&(n.service===null||n.staff===null))n.page=n.service===null?'services':'staff';
 // The header animation rides on the page's own message, so it is sent only when the page actually
 // changes — or when an old button asked for this very screen to be put back on top of the chat.
 n.header=HEADERS[n.page]&&(action===REFRESH||n.page!==s.page)&&!n.paused?n.page:null;
 return n;
}
export function stepsFor(s,action,start=false,fileIds={}){
 const steps=[];const c=SCHEMAS[s.industry];
 // The bottom keyboard is attached only where the user asked for it: /start and the explicit /keyboard call.
 if(!s.paused&&(start||action==='keyboard'))steps.push({method:'sendMessage',body:{chat_id:s.chatId,text:KEYBOARD_TEXT,reply_markup:replyKeyboard()}});
 if(!s.paused&&action==='keyboard_off')steps.push({method:'sendMessage',body:{chat_id:s.chatId,text:KEYBOARD_OFF_TEXT,reply_markup:{remove_keyboard:true}}});
 // One wide collage for the whole roster instead of one tall portrait per person: the faces, their
 // names and the dummy shift arrive as a single short strip that does not take over the chat.
 // Like the headers, the collage is uploaded once and afterwards referenced by its file_id.
 if(!s.paused&&c&&(/^i\d$/.test(action)||action==='staff_cards'))steps.push({method:'sendPhoto',asset:c.strip,body:{chat_id:s.chatId,photo:fileIds?.[c.strip]??c.strip,parse_mode:'HTML',caption:[`<b>${esc(c.label)}｜架空スタッフ${c.staff.length}名</b>`,i(`${c.staff.map(p=>`${p.name}（${p.age}歳設定）`).join('／')}・AI生成の架空成人・複数業態共通デモ人物`),`🗓 ${esc(c.shift)}`,`🕒 ${esc(c.slots.map((_,n)=>slotText(c,n)).join('／'))}`,'🚫 実在スタッフ・実際の空き枠ではありません'].join('\n')}});
 if(!s.paused&&action==='animate')steps.push(media(SHOWCASE,{chat_id:s.chatId,parse_mode:'HTML',caption:[bA('🎞 動く装飾のサンプル 🎉'),i(NOTICE)].join('\n')},fileIds));
 steps.push(menuStep(s,fileIds,start));return steps;
}
// Builds the single message the user actually reads: header GIF on top, HTML caption under it, buttons below.
export function menuStep(s,fileIds={},force=false){
 // /start lands on a page it was already notionally on, so it asks for the header explicitly.
 const v=view(s),name=(s.header||force)&&!s.paused?HEADERS[s.page]:null;
 if(name&&v.plain.length<=CAPTION_LIMIT)
  return {...media(name,{chat_id:s.chatId,parse_mode:'HTML',caption:v.text,reply_markup:v.reply_markup},fileIds),menu:true};
 return {method:'sendMessage',menu:true,body:{chat_id:s.chatId,text:v.text,parse_mode:'HTML',reply_markup:v.reply_markup}};
}
// Second and later sends of the same asset reuse the file_id Telegram returned instead of re-uploading.
function media(name,body,fileIds){return {method:'sendAnimation',asset:name,body:{...body,animation:fileIds?.[name]??name}};}
