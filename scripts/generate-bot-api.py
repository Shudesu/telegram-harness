#!/usr/bin/env python3
"""Generate the reviewed Bot API snapshot from a locally downloaded official HTML page.
Usage: python3 scripts/generate-bot-api.py /tmp/telegram-harness-bot-api.html
No network, credentials, or Telegram calls. Review method permissions before committing.
"""
from html.parser import HTMLParser
from pathlib import Path
import json
import re
import sys

class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []
    def text(self):
        return ''.join(c.text() if isinstance(c, Node) else c for c in self.children)
    def find(self, tag):
        return [n for c in self.children if isinstance(c, Node) for n in ([c] if c.tag == tag else []) + c.find(tag)]

class Parser(HTMLParser):
    def __init__(self):
        super().__init__(); self.root = Node(); self.stack = [self.root]
    def handle_starttag(self, tag, attrs):
        n = Node(tag, attrs); self.stack[-1].children.append(n)
        if tag not in ('br', 'hr', 'img', 'input', 'meta', 'link'): self.stack.append(n)
    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1, 0, -1):
            if self.stack[i].tag == tag:
                self.stack = self.stack[:i]; break
    def handle_data(self, data): self.stack[-1].children.append(data)

parser = Parser(); parser.feed(Path(sys.argv[1]).read_text())
sections = {}
def visit(n):
    section = None
    for c in n.children:
        if not isinstance(c, Node): continue
        if c.tag in ('h3', 'h4'):
            name = c.text().strip()
            section = [] if c.tag == 'h4' else None
            if section is not None: sections[name] = section
        elif section is not None: section.append(c)
        visit(c)
visit(parser.root)
methods = {k:v for k,v in sections.items() if re.fullmatch('[a-z][A-Za-z0-9]+', k)}
types = {k:v for k,v in sections.items() if re.fullmatch('[A-Z][A-Za-z0-9]+', k)}
assert len(methods) >= 160, 'Official document format changed; review parser'

def schema(text):
    text = ' '.join(text.split())
    if text.startswith('Array of '): return {'type':'array','items':schema(text[9:])}
    parts = re.split(r',? or |,? and |, ', text)
    if len(parts)>1: return {'anyOf':[schema(p) for p in parts]}
    simple = {'Integer':'integer','Int':'integer','Float':'number','Float number':'number','String':'string','Boolean':'boolean','True':'boolean'}
    if text in simple: return {'type':simple[text]}
    assert text in types or text == 'InputFile', f'Unknown type: {text}'
    return {'ref':text}

def fields(nodes, method=False):
    tables = [n for n in nodes if n.tag=='table']
    if not tables: return None
    result = {}; required = []
    for row in tables[0].find('tr'):
        cells = row.find('td')
        if not cells: continue
        name, kind = cells[0].text().strip(), cells[1].text().strip()
        desc = cells[-1].text().strip()
        item = schema(kind)
        if name in ('secret_token','provider_token'):
            item = {'ref':'SecretReference'}
            if name=='provider_token': item={'anyOf':[item, {'const':''}]}
        # Discriminators improve union validation and the generated TS contracts.
        match = re.search(r'(?:must be|always) [“\"]([^”\"]+)[”\"]', desc)
        if kind == 'String' and match: item = {'const':match.group(1)}
        result[name] = item
        optional = cells[2].text().strip() != 'Yes' if method else desc.startswith('Optional')
        if not optional: required.append(name)
    return {'type':'object','properties':result,'required':required,'additionalProperties':False}

def ts(s):
    if 'ref' in s: return s['ref']
    if 'const' in s: return json.dumps(s['const'])
    if 'anyOf' in s: return ' | '.join(ts(x) for x in s['anyOf'])
    t=s['type']
    if t=='array': return '('+ts(s['items'])+')[]'
    if t=='object':
        if not s['properties']: return 'Record<string, never>'
        return '{\n'+''.join('  '+k+('' if k in s['required'] else '?')+': '+ts(v)+';\n' for k,v in s['properties'].items())+'}'
    return 'number' if t=='integer' else t

schemas={}
for name,nodes in types.items():
    if name=='InputFile': continue
    f = fields(nodes)
    if f is None:
        links=[a.text() for n in nodes if n.tag=='ul' for a in n.find('a') if a.text() in types and a.text()!=name]
        if not links:
            assert any('no information' in n.text() or 'no fields' in n.text() for n in nodes), 'No schema for '+name
            f={'type':'object','properties':{},'required':[],'additionalProperties':False}
        else: f={'anyOf':[{'ref':x} for x in dict.fromkeys(links)]}
    schemas[name]=f
schemas['InputFile']={'type':'object','properties':{'filename':{'type':'string'},'base64':{'type':'string'},'contentType':{'type':'string'}},'required':['filename','base64'],'additionalProperties':False}
schemas['SecretReference']={'type':'object','properties':{'secretEnvName':{'type':'string'}},'required':['secretEnvName'],'additionalProperties':False}
params={name:fields(nodes,True) or {'type':'object','properties':{},'required':[],'additionalProperties':False} for name,nodes in methods.items()}
# Explicitly reviewed read list. New methods default to approval-required.
reads=set('getWebhookInfo getMe getUserProfilePhotos getUserProfileAudios getFile getChat getChatAdministrators getChatMemberCount getChatMember getUserPersonalChatMessages getForumTopicIconStickers getUserChatBoosts getBusinessConnection getManagedBotAccessSettings getMyCommands getMyName getMyDescription getMyShortDescription getChatMenuButton getMyDefaultAdministratorRights getAvailableGifts getBusinessAccountStarBalance getBusinessAccountGifts getUserGifts getChatGifts getStickerSet getCustomEmojiStickers getMyStarBalance getStarTransactions getGameHighScores'.split())
excluded={'logOut':'Bot API サーバーのセッション終了を伴うため対象外', 'close':'Bot API インスタンスの終了を伴うため対象外', 'getManagedBotToken':'管理対象 Bot の秘密トークンを返すため汎用レスポンスから除外', 'replaceManagedBotToken':'管理対象 Bot の認証情報失効と秘密トークン返却を伴うため除外'}
assert reads <= methods.keys() and excluded.keys() <= methods.keys()
registry={name:{'mode':'excluded' if name in excluded else 'read' if name in reads else 'write', **({'reason':excluded[name]} if name in excluded else {})} for name in methods}
header='// Generated by scripts/generate-bot-api.py; review permission changes.\n// Source: https://core.telegram.org/bots/api — Bot API 10.3, checked 2026-11-04.\n'
root=Path(__file__).resolve().parent.parent
out=header+'import type { Schema } from "./api-schema.js";\n\n'
out+='export namespace BotApi {\n'+''.join('export type '+name+' = '+ts(s)+';\n' for name,s in schemas.items())+'}\n\n'
out+='export interface BotMethodParams {\n'+''.join('  '+name+': '+ts(s).replace('InputFile','BotApi.InputFile').replace('SecretReference','BotApi.SecretReference')+';\n' for name,s in params.items())+'}\n'
# Qualify generated object names in method parameter types only.
pre, post=out.split('export interface BotMethodParams')
for name in sorted(set(schemas)-{'InputFile','SecretReference'}, key=len, reverse=True):
    post=re.sub(r'(?<![\w.])'+name+r'\b', 'BotApi.'+name, post)
out=pre+'export interface BotMethodParams'+post
out+='\nexport const BOT_METHODS = '+json.dumps(registry,ensure_ascii=False,indent=2)+' as const;\n'
out+='export type BotMethod = keyof BotMethodParams;\n'
out+='export type BotReadMethod = { [M in BotMethod]: typeof BOT_METHODS[M]["mode"] extends "read" ? M : never }[BotMethod];\n'
out+='export type BotWriteMethod = { [M in BotMethod]: typeof BOT_METHODS[M]["mode"] extends "write" ? M : never }[BotMethod];\n'
out+='export const BOT_TYPES: Record<string, Schema> = '+json.dumps(schemas,ensure_ascii=False,separators=(',',':'))+';\n'
out+='export const BOT_SCHEMAS: Record<BotMethod, Schema> = '+json.dumps(params,ensure_ascii=False,separators=(',',':'))+';\n'
(root/'packages/shared/src/bot-api.generated.ts').write_text(out)
print(f'Generated {len(methods)} methods, {len(schemas)} types; {len(reads)} reads, {len(methods)-len(reads)-len(excluded)} writes, {len(excluded)} exclusions')
