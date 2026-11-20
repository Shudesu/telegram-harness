#!/usr/bin/env node
// `wrangler deploy` に元コミットを付けて実行する（Cloudflare の Version の message に残り、
// `wrangler deployments list` で見える）。未commitの変更があれば -dirty を付ける。
// 追加の引数はそのまま wrangler へ渡す。
import { execFileSync, spawnSync } from 'node:child_process';
const git = (args) => { try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const sha = (git(['rev-parse', 'HEAD']) || 'unknown') + (git(['status', '--porcelain']) ? '-dirty' : '');
const r = spawnSync('wrangler', ['deploy', '--message', `git-${sha}`, ...process.argv.slice(2)], { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
