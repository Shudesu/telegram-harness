export const GENERATION='conversation-t14u-20261106-r2';
// Your bot's numeric id (the digits before ':' in the bot token). Callbacks are accepted only from this bot.
export const BOT=1234567890; // ← replace with your bot id
export const ASSET_ROOT='./assets';
const face=(name,age,image)=>({name,age,image:`staff-${image}.jpg`});
const people=[face('蒼・デモ',32,0),face('凛・デモ',30,1),face('楓・デモ',29,2),face('澪・デモ',34,3),face('紗月・デモ',28,4),face('彩・デモ',31,5)];
// `short` is the button label: two to six characters so a row of three still reads at phone width.
// `brief` does the same for a service. The long `label`/`name` stay for the body text and receipts.
// `strip` is the one wide collage that replaces the per-person portraits: industries that share both
// a roster and a shift band share a file, so nine industries need five images.
const schema=(id,label,short,services,staff,evening,answer)=>({id,label,short,services:services.map(([name,brief,minutes,yen])=>({name,brief,minutes,yen})),staff:staff.map(i=>people[i]),strip:`staff-strip-${staff.join('')}-${evening?'eve':'day'}.jpg`,slots:evening?['2026-11-10T19:00:00+09:00','2026-11-12T20:00:00+09:00']:['2026-11-10T10:00:00+09:00','2026-11-12T14:00:00+09:00'],shift:evening?'2026/11/10・11/12 18:00–23:00 JST':'2026/11/10・11/12 10:00–17:00 JST',faq:{price:'金額は画面検証用の架空の総額（税込想定）です。追加料金・実請求はありません。',hours:evening?'サンプル営業時間は18:00–23:00 JSTです。実店舗は存在しません。':'サンプル営業時間は10:00–17:00 JSTです。実店舗は存在しません。',cancel:'TEST受付のみ取り消せます。キャンセル料・実予約はありません。',service:answer,safety:'スタッフは全員25歳以上という設定のAI生成の架空成人です。実在人物・店舗との関係はありません。個人情報は入力しないでください。'}});
export const SCHEMAS=[
 schema('ai','AI活用相談','AI相談',[['問い合わせ対応の相談','問い合わせ',30,3000],['資料・社内情報整理の相談','資料整理',60,6000]],[0,1],false,'固定の相談例をご案内します。一般LLMは動作しておらず、個別の実務処理も実行しません。'),
 schema('beauty','美容室・美容サロン','美容室',[['ヘア相談','ヘア',30,3000],['スタイル相談','スタイル',60,6000]],[2,3],false,'ヘア・スタイルの相談受付を模したデモです。施術や診断は行いません。'),
 schema('restaurant','飲食店','飲食店',[['お席の相談（2名想定）','お席',60,4000],['コース相談（2名想定）','コース',90,8000]],[0,1],false,'架空の席・コースの相談です。アレルギーや実店舗の対応は確認していません。'),
 schema('bodywork','整体・リラクゼーション','整体',[['ボディケア相談','ボディケア',30,3000],['休息プラン相談','休息',60,5000]],[2,3],false,'架空のボディケア受付です。医療行為・診断・治療効果の保証はありません。'),
 schema('cabaret','キャバクラ','キャバクラ',[['ラウンジ歓談プラン','歓談',60,6000],['ノンアルコール歓談プラン','ノンアル',60,5000]],[4,5],true,'25歳以上の架空成人による非露骨な歓談デモです。性的サービス・飲酒の勧誘・実店舗の紹介は行いません。'),
 schema('host','ホストクラブ','ホスト',[['歓談プラン','歓談',60,6000],['ノンアルコール歓談プラン','ノンアル',60,5000]],[0],true,'架空成人との非露骨な歓談受付デモです。実来店・飲酒・支払いの勧誘はありません。'),
 schema('bar','バー','バー',[['ノンアルコール席相談','ノンアル席',60,3000],['軽食つき席相談','軽食つき',90,5000]],[0,4],true,'席とノンアルコールの架空プランです。実店舗は存在しません。'),
 schema('massage','マッサージ','マッサージ',[['リフレッシュ相談','リフレッシュ',30,3000],['ボディケア相談','ボディケア',60,5000]],[0,1],false,'健全なリフレッシュ受付のデモです。医療行為・性的サービス・実施術はありません。'),
 schema('relaxation','リラクゼーション','リラク',[['休息プラン相談','休息',30,2500],['アロマ気分の相談','アロマ',60,4500]],[2,3],false,'休息の相談受付デモです。実際の施術・効能の保証はありません。'),
];
export const INDUSTRIES=SCHEMAS.map(x=>x.label);
// The wide staff collages the engine may upload, deduplicated; the handler builds its upload
// allowlist from this list, so a face that is not on it can never be sent.
export const STRIPS=[...new Set(SCHEMAS.map(x=>x.strip))];
// Decoration is now carried by the header GIFs and per-line meaning emoji, so the disclosure line
// is plain prose. The flask glyph that used to prefix literally every reply is gone from this flow;
// the test suite greps these sources for it, which is why it is described here rather than written.
export const NOTICE='TEST用デモ・実予約／請求／外部通知なし';
// Original wide header animations generated for this bot, now H.264 MP4 instead of 256-colour GIF
// (2048x800, 30 fps, no audio; see 20261110/hq-gif-expired/mp4/make-headers.mjs). sendAnimation takes
// 'GIF or H.264/MPEG-4 AVC video without sound', so the message shape is unchanged and the picture
// is no longer dithered down to a palette. Keyed by the page whose top they head; the handler's
// upload allowlist is built from this map.
export const HEADERS={industries:'hdr-booking.mp4',member:'hdr-member.mp4',compose:'hdr-compose.mp4'};
// Sent only when someone presses the decoration button; never a header, never automatic.
export const SHOWCASE='hdr-decor.mp4';
export const ANIMATIONS=[...new Set([...Object.values(HEADERS),SHOWCASE])];
// parse_mode HTML needs every interpolated value escaped; only <b>/<i>/<tg-emoji> are ever emitted as markup.
export const esc=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
// The eight animated emoji this bot published for its owner: set teleharness_brand_by_teleharness_bot
// (custom_emoji, video .WEBM VP9 100x100, 2.0 s, generated in 20261110/animated-emoji/emoji).
// Keyed by the plain glyph the set registers, which is therefore also the visible fallback: wherever
// the markup is dropped — non-Premium viewer, forward, system notification, the 400 retry below —
// the wording is byte-identical apart from the wrapper.
export const CUSTOM_EMOJI={
 '🔥':'6310051460339999660',
 '💎':'6311855458273470053',
 '👑':'6310035972687931231',
 '⭐':'6312195877381350057',
 '🎉':'6312002161471398636',
 '📅':'6309813643705853485',
 '👤':'6312266117276508833',
 '🎨':'6312114878593115559',
};
export const EMOJI_BY_ID=Object.fromEntries(Object.entries(CUSTOM_EMOJI).map(([glyph,id])=>[id,glyph]));
// Only glyphs we actually own become animated; everything else is passed straight through.
export const ce=glyph=>CUSTOM_EMOJI[glyph]?`<tg-emoji emoji-id="${CUSTOM_EMOJI[glyph]}">${glyph}</tg-emoji>`:glyph;
const TG_EMOJI=/<tg-emoji emoji-id="\d+">(.*?)<\/tg-emoji>/g;
export const hasCustomEmoji=html=>typeof html==='string'&&html.includes('<tg-emoji ');
// Telegram only accepts custom emoji from a bot whose owner has Premium; a 400 is proof the message
// was NOT delivered, so the same copy can safely go out again with the wrappers removed.
export const stripCustomEmoji=html=>typeof html==='string'?html.replace(TG_EMOJI,'$1'):html;
// Bot API 9.4 gave KeyboardButton/InlineKeyboardButton two appearance fields: icon_custom_emoji_id
// (an animated icon drawn before the label, gated on the owner's Premium exactly like <tg-emoji>)
// and style ('danger' | 'success' | 'primary', no such gate). Buttons carry the icon INSTEAD of a
// glyph in their text, so undoing it has to put the fallback glyph back in front of the label.
const ROWS=['inline_keyboard','keyboard'];
const mapButtons=(rm,fn)=>{const out={...rm};for(const k of ROWS)if(Array.isArray(out[k]))out[k]=out[k].map(row=>row.map(fn));return out;};
export const hasButtonIcons=rm=>!!rm&&ROWS.some(k=>(rm[k]??[]).some(row=>row.some(b=>b.icon_custom_emoji_id)));
export const stripButtonIcons=rm=>!rm?rm:mapButtons(rm,b=>{if(!b.icon_custom_emoji_id)return b;const {icon_custom_emoji_id:id,...rest}=b;const glyph=EMOJI_BY_ID[id];return glyph?{...rest,text:`${glyph} ${rest.text}`}:rest;});
// One message can carry the markup in three places at once, so both checks look at the whole body.
export const bodyHasCustomEmoji=body=>hasCustomEmoji(body?.caption)||hasCustomEmoji(body?.text)||hasButtonIcons(body?.reply_markup);
export const plainBody=body=>{const out={...body};for(const f of ['caption','text'])if(typeof out[f]==='string')out[f]=stripCustomEmoji(out[f]);if(out.reply_markup)out.reply_markup=stripButtonIcons(out.reply_markup);return out;};
// The visible length Telegram counts (captions 1024, messages 4096) is the text after entity parsing,
// and a custom emoji counts only as its fallback glyph.
export const plain=html=>html.replace(TG_EMOJI,'$1').replace(/<\/?[bi]>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
export function slotText(s,i){const date=new Date(s.slots[i]);return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date)+' JST';}
// The same slot as a button label: no year, no zone, so three of them still fit a two-column row.
export function slotLabel(s,i){const date=new Date(s.slots[i]);return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date).replace(/\s+/g,' ');}
export function selection(s){const c=SCHEMAS[s.industry];if(!c)return '業態：未選択';return [`業態：${c.label}`,`サービス：${c.services[s.service]?.name??'未選択'}`,`架空スタッフ：${c.staff[s.staff]?.name??'未選択'}`,`ダミー枠：${s.slot===null?'未選択':slotText(c,s.slot)}`,`サンプル見積：${s.service===null?'未選択':c.services[s.service].yen.toLocaleString('ja-JP')+'円（架空の総額・税込想定）'}`].join('\n');}
