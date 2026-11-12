// HTML generation for Telegram's classic `parse_mode: "HTML"`.
//
// The editor never accepts markup. A draft is a list of structured blocks, and this module
// is the only thing that produces tags — so there is no path by which user text can become
// HTML. That is what makes "escape everything" checkable rather than hopeful.
import {NAMED_ENTITIES, LIMITS, DIVIDERS, ORNAMENTS} from './spec.mjs';

// Only the four supported named entities. `&apos;` would be invalid here, so an apostrophe
// is left alone — it needs no escaping in text content.
export const escape = s => String(s).replace(/[&<>"]/g, c => NAMED_ENTITIES[c]);
// Inside an href the quote must go; the rest follow the same rule.
export const escapeAttr = s => escape(s);

export const BLOCK_KINDS = ['heading', 'text', 'bold', 'italic', 'underline', 'strike',
  'spoiler', 'code', 'pre', 'quote', 'quote_expandable', 'list', 'numbered', 'link', 'divider', 'spacer'];

const WRAP = {bold:'b', italic:'i', underline:'u', strike:'s', spoiler:'tg-spoiler', code:'code', heading:'b'};

export function urlProblem(url) {
  if (typeof url !== 'string' || !url) return 'url_required';
  if (url.length > LIMITS.urlChars.value) return 'url_too_long';
  let parsed;
  try { parsed = new URL(url); } catch { return 'url_malformed'; }
  // https only: stricter than Telegram on purpose. http in a paid-membership message is a
  // downgrade a recipient cannot see, and javascript:/data: must never be reachable.
  if (parsed.protocol !== 'https:') return 'url_not_https';
  if (parsed.username || parsed.password) return 'url_has_credentials';
  if (parsed.hostname.length < 3 || !parsed.hostname.includes('.')) return 'url_bad_host';
  return null;
}

// One block → one line (or lines) of HTML. Unknown kinds throw: silently dropping a block
// would mean the preview and the message disagree.
export function renderBlock(block) {
  const kind = block?.kind;
  if (!BLOCK_KINDS.includes(kind)) throw new Error('invalid_block_kind');
  const text = String(block.text ?? '');
  if (kind === 'divider') return escape(DIVIDERS[block.style] ?? DIVIDERS.line);
  if (kind === 'spacer') return '';
  if (kind === 'link') {
    const problem = urlProblem(block.href);
    if (problem) throw new Error(problem);
    return `<a href="${escapeAttr(block.href)}">${escape(text || block.href)}</a>`;
  }
  if (kind === 'pre') return `<pre>${escape(text)}</pre>`;
  if (kind === 'quote') return `<blockquote>${escape(text)}</blockquote>`;
  // `expandable` is an attribute on blockquote, not a tag of its own.
  if (kind === 'quote_expandable') return `<blockquote expandable>${escape(text)}</blockquote>`;
  if (kind === 'list') return text.split('\n').filter(Boolean).map(line => `${ORNAMENTS.bullet}${escape(line)}`).join('\n');
  if (kind === 'numbered') return text.split('\n').filter(Boolean).map((line, i) => `${i + 1}. ${escape(line)}`).join('\n');
  if (kind === 'text') return escape(text);
  return `<${WRAP[kind]}>${escape(text)}</${WRAP[kind]}>`;
}

export const renderBlocks = blocks => blocks.map(renderBlock).join('\n');

// What the recipient actually reads, which is what the length limit counts. Built by
// rendering and then removing exactly the tags we generate, so the count can never drift
// from the markup we send.
export function visibleText(html) {
  return html
    .replace(/<\/?(?:b|i|u|s|tg-spoiler|code|pre|blockquote)(?: expandable)?>/g, '')
    .replace(/<a href="[^"]*">/g, '').replace(/<\/a>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
// UTF-16 code units: an emoji costs 2, which is the stricter and safer reading.
export const visibleLength = html => visibleText(html).length;
