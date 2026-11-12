// Ready-made drafts for the uses this product actually has. Plain, standard Japanese: no
// manufactured urgency, no invented numbers, and every placeholder reads as a placeholder
// so an unedited template cannot be mistaken for finished copy.
//
// Media URLs are deliberately `https://example.invalid/...`: an obviously non-resolving
// dummy. No GIF is generated or fetched here, and no third-party media service is used.
import {DIVIDERS, ORNAMENTS} from './spec.mjs';
import {emptyDraft} from './compose.mjs';

export const DUMMY_GIF = 'https://example.invalid/test-assets/placeholder.gif';
export const DUMMY_PHOTO = 'https://example.invalid/test-assets/placeholder.jpg';
const LINK = 'https://example.invalid/test-landing';
// The SKU id the pay template points at. The owner's catalog has to define it (or the owner
// re-points the button in the editor) before the template compiles.
export const TEMPLATE_PAY_SKU = 'member_monthly';

const draft = (id, title, media, blocks, buttons) => emptyDraft({
  id:null, templateId:id, title, media, blocks, buttons,
});

export const TEMPLATES = [
  draft('membership-open', '会員募集（GIF＋プラン案内）',
    {kind:'animation', url:DUMMY_GIF, note:'差し替え前のダミー。実素材に置き換えてください'},
    [
      {kind:'heading', text:'会員グループの受付を開始しました'},
      {kind:'divider', style:'line'},
      {kind:'text', text:'参加すると、グループ内の投稿とアーカイブをすべて読めます。'},
      {kind:'list', text:'月額プラン：1,800円\n3ヶ月プラン：4,800円\n永久パス：600円（雑談グループのみ）'},
      {kind:'spacer'},
      {kind:'italic', text:'期限は決済が確定した時刻から数えます。'},
    ],
    [[{kind:'url', label:'プランを見る', url:LINK}], [{kind:'callback', label:'あとで通知する', data:'richmsg/remind/later'}]]),

  draft('renewal-reminder', '更新のご案内（期限が近い会員向け）',
    {kind:'none', url:'', note:''},
    [
      {kind:'heading', text:'会員期限が近づいています'},
      {kind:'text', text:'期限前に更新すると、残っている期間に上乗せされます。日数は損しません。'},
      {kind:'quote', text:'期限：（ここに日時）\n対象：（ここにグループ名）'},
      {kind:'divider', style:'dots'},
      {kind:'text', text:`${ORNAMENTS.arrow}更新は会員ページから行えます。`},
    ],
    [[{kind:'url', label:'会員ページを開く', url:LINK}]]),

  draft('seminar-notice', 'セミナー告知（画像＋日時）',
    {kind:'photo', url:DUMMY_PHOTO, note:'差し替え前のダミー'},
    [
      {kind:'heading', text:'オンライン勉強会のお知らせ'},
      {kind:'divider', style:'stars'},
      {kind:'numbered', text:'日時：（ここに日時）\n場所：オンライン\n参加費：会員は無料'},
      {kind:'spacer'},
      {kind:'text', text:'当日の入室リンクは開始前にこのグループへ投稿します。'},
      {kind:'spoiler', text:'（補足）録画は後日アーカイブに追加します。'},
    ],
    [[{kind:'url', label:'詳細', url:LINK}, {kind:'callback', label:'参加する', data:'richmsg/seminar/join'}]]),

  draft('expiry-notice', '期限切れのお知らせ',
    {kind:'none', url:'', note:''},
    [
      {kind:'heading', text:'会員期限が切れました'},
      {kind:'text', text:'グループの席を解除します。追放ではないので、再購入すれば入り直せます。'},
      {kind:'divider', style:'line'},
      {kind:'italic', text:'この文面は自前設計です。参照Botの挙動の再現ではありません。'},
    ],
    [[{kind:'url', label:'買い直す', url:LINK}]]),

  // Pay button: the price is not written into the copy. The button label is generated from
  // the catalog SKU at send time, so editing the price in one place updates the message.
  // A membership of a Telegram group is a digital good, so the template defaults to Stars.
  draft('membership-pay', '会員募集（決済ボタン付き）',
    {kind:'animation', url:DUMMY_GIF, note:'差し替え前のダミー。実素材に置き換えてください'},
    [
      {kind:'heading', text:'会員グループに参加しませんか'},
      {kind:'divider', style:'stars'},
      {kind:'text', text:'参加すると、グループ内の投稿とアーカイブをすべて読めます。'},
      {kind:'list', text:'（ここに特典1）\n（ここに特典2）'},
      {kind:'spacer'},
      {kind:'quote', text:'下のボタンからそのまま支払えます。支払いが確認でき次第、招待リンクをお送りします。'},
      {kind:'italic', text:'期限は決済が確定した時刻から数えます。'},
    ],
    [[{kind:'pay', label:'', skuId:TEMPLATE_PAY_SKU, provider:'telegram_stars'}]]),

  draft('plain-announce', 'お知らせ（文字だけ・装飾最小）',
    {kind:'none', url:'', note:''},
    [
      {kind:'bold', text:'お知らせ'},
      {kind:'text', text:'（ここに本文）'},
    ],
    []),
];

export const templateById = id => TEMPLATES.find(t => t.templateId === id) ?? null;
// A fresh copy every time: a template must not be mutated by editing a draft made from it.
export const fromTemplate = id => {
  const template = templateById(id);
  return template ? structuredClone(template) : null;
};
export {DIVIDERS, ORNAMENTS};
