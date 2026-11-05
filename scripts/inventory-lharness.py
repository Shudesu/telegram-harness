#!/usr/bin/env python3
"""Read source metadata only (tracked and non-ignored additions). Never import/execute source or traverse symlinks."""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
root = Path(sys.argv[1]).absolute()
if root.is_symlink():
    raise SystemExit('source root must not be a symlink')
root = root.resolve()
tracked = set(subprocess.check_output(['git', '-C', str(root), 'ls-files'], text=True).splitlines())
added = set(subprocess.check_output(['git', '-C', str(root), 'ls-files', '--others', '--exclude-standard'], text=True).splitlines())
modified = set(subprocess.check_output(['git', '-C', str(root), 'diff', 'HEAD', '--name-only'], text=True).splitlines())
files = sorted(tracked | added)
commit = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
# Explicit classification: additions must be reviewed instead of silently omitted.
groups = {
 'F01': 'friends profile-refresh users users-grouped duplicates',
 'F02': 'tags', 'F03': 'scenarios', 'F04': 'broadcasts dedup-preview',
 'F05': 'auto-replies', 'F06': 'message-templates templates',
 'F07': 'rich-menus rich-menu-groups', 'F08': 'forms liff',
 'F09': 'tracked-links', 'F10': 'entry-routes traffic-pools',
 'F11': 'calendar booking', 'F12': 'events', 'F13': 'meet-consultations meet-callback',
 'F14': 'reminders', 'F15': 'webinars', 'F16': 'stripe',
 'F17': 'scoring', 'F18': 'automations', 'F19': 'webhooks webhook',
 'F20': 'notifications', 'F21': 'chats conversations inbox',
 'F22': 'images', 'F23': 'conversions', 'F24': 'ad-platforms',
 'F25': 'affiliates affiliate-self affiliate-offers', 'F26': 'live-games six-games',
 'F27': 'line-accounts account-settings', 'F28': 'staff admin-auth admin-sso',
 'F29': 'admin-update admin-version', 'F30': 'health usage capabilities setup openapi',
 'F31': 'line-proxy', 'F32': 'instagram-engagement', 'F33': 'media-inquiries',
}
lookup = {name: group for group, names in groups.items() for name in names.split()}
services = {
 'F01':'duplicate-detect duplicates-stats follower-import users-grouped',
 'F02':'friend-tag-attach tag-automation-context',
 'F03':'immediate-first-step intro-message step-delivery scenario-stats',
 'F04':'broadcast-delivery-error broadcast-retry-key broadcast-sender broadcast dedup-broadcast segment-query segment-send message-group',
 'F05':'auto-reply keyword-match', 'F06':'render-message', 'F08':'liff-auth', 'F09':'auto-track',
 'F11':'availability booking-calendar-sync booking-confirm booking-expirer booking-idempotency booking-notifier booking-reminders booking-state booking-types google-calendar google-oauth google-service-account',
 'F12':'event-availability event-booking-expirer event-booking-idempotency event-booking-notifier event-booking-reminders event-booking-state event-booking-types',
 'F13':'meet-consultation-reminders sales-consultation-policy webinar-consultation-booking',
 'F14':'reminder-delivery', 'F15':'webinar-followups webinar-reminders webinar-schedule',
 'F18':'event-bus', 'F19':'webhook-signature', 'F20':'activity-digest', 'F21':'unanswered-inbox',
 'F22':'incoming-image', 'F24':'ad-conversion insight-fetcher', 'F25':'affiliate-notifier',
 'F26':'live-game-auth live-game-store live-game six-community six-game-auth six-game-store six-game six-leaderboard',
 'F27':'ban-monitor token-refresh', 'F30':'log-retention quota-alert quota',
 'F31':'line-proxy-send local-line-proxy',
 'F35':'activity-mileage camp-offer-delivery reward-message reward-resolver webinar-mileage',
 'X01':'stealth',
}
service_lookup = {name: group for group, names in services.items() for name in names.split()}
records=[]
for name in files:
    route = name.startswith('apps/worker/src/routes/') and name.endswith('.ts') and not name.endswith('.test.ts')
    service = name.startswith('apps/worker/src/services/') and name.endswith('.ts') and not name.endswith('.test.ts')
    mcp = name.startswith('packages/mcp-server/src/tools/') and name.endswith('.ts')
    doc = (name.startswith(('docs/wiki/', 'docs/manual/', 'docs/plugins/')) and name.endswith('.md')) or name in ('README.md','SPEC.md','COMPETITOR_FEATURES.md')
    extra = name in ('apps/worker/src/index.ts','apps/worker/src/scheduled.ts','apps/worker/src/durable-objects/tenant-scheduler.ts') or (name.startswith(('packages/update-engine/src/','packages/plugin-template/src/','examples/plugins/tag-rules/','docs/community-mile-rewards/')) and name.endswith(('.ts','.md')) and not name.endswith('.test.ts'))
    if not (route or service or mcp or doc or extra): continue
    path=root/name
    if path.is_symlink() or not path.resolve().is_relative_to(root): raise SystemExit('source outside root: '+name)
    content=path.read_text()
    group=lookup.get(path.stem) if route else service_lookup.get(path.stem) if service else 'F34' if mcp else ('F36' if 'plugin' in name else 'F29' if 'update-engine' in name else 'F35' if 'community-mile' in name else 'F30') if extra else 'DOC'
    if group is None: raise SystemExit('unclassified source: '+name)
    record={'path':name,'group':group,'workingTreeState':'untracked' if name in added else 'modified' if name in modified else 'HEAD','sha256':hashlib.sha256(content.encode()).hexdigest()}
    if route or name == 'apps/worker/src/index.ts':
        receivers = re.findall(r'(?:const|let)\s+(\w+)\s*=\s*new Hono', content)
        pattern = r'\b(?:'+'|'.join(map(re.escape,receivers))+r")\.(get|post|put|patch|delete|all)\(\s*(?:['\"]([^'\"]*)['\"]|([A-Za-z_][\w.]*))"
        record['endpoints']=[{'method':m.group(1).upper(),'path':m.group(2) if m.group(2) is not None else '<expression:'+m.group(3)+'>','line':content[:m.start()].count('\n')+1} for m in re.finditer(pattern,content)] if receivers else []
        if route and not receivers: raise SystemExit('no router parsed: '+name)
    if doc:
        record['headings']=[line for line in content.splitlines() if re.match(r'^#{1,3} ',line)]
    records.append(record)
out=Path('docs/parity-lharness-inventory.json')
out.write_text(json.dumps({'sourceCommit':commit,'method':'working tree including tracked modifications and non-ignored source additions; route/service groups exhaustive; hashes identify the exact inspected content; docs are supporting descriptions, not proof of deployment','records':records},ensure_ascii=False,indent=2)+'\n')
lines=['# L Harness 棚卸し補助索引','','[判定表](parity-lharness.md)の機能IDに対応。実装の存在を示す索引であり、本番での有効化・動作保証ではない。ソースコード本文の複製なし。','','| 種別・元ファイル | 判定表ID | HTTP入口数 |','|---|---|---|']
for r in records:
    if r['group']!='DOC': lines.append(f"| `{r['path']}` | {r['group']} | {len(r.get('endpoints',[])) if 'endpoints' in r else '—'} |")
lines += ['','## HTTP操作単位の照合','','全入口は親の判定・優先度を継承。LINE固有の経路名をTelegramへそのまま移植する意味ではない。','','| 元ファイル:行 | 操作 | 判定表ID |','|---|---|---|']
for r in records:
    for e in r.get('endpoints',[]): lines.append(f"| `{r['path']}:{e['line']}` | `{e['method']} {e['path']}` | {r['group']} |")
Path('docs/parity-lharness-index.md').write_text('\n'.join(lines)+'\n')
print(f"Inventoried {len(records)} files, {sum(len(r.get('endpoints',[])) for r in records)} endpoints; no unclassified route/service modules. Source {commit}")
