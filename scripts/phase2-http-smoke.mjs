// HTTP-only verification: no browser or browser automation. Synthetic local data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'telegram-harness-http-'));
const api = 'http://127.0.0.1:18787', web = 'http://127.0.0.1:13005', key = 'synthetic-phase2-http-key';
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, API_KEY: key, TELEGRAM_CRM_DB_PATH: join(dir, 'fixture.sqlite'), PORT: '18787', TELEGRAM_LOCAL_UI: 'true', TELEGRAM_HARNESS_API_URL: api, NEXT_TELEMETRY_DISABLED: '1' };
const children = [];
function start(args) { const child = spawn('pnpm', args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); children.push(child); child.stdout.resume(); child.stderr.resume(); return child; }
async function ready(url) { for (let i = 0; i < 100; i++) {
    try {
        const r = await fetch(url);
        if (r.ok)
            return;
    }
    catch { }
    await new Promise(r => setTimeout(r, 150));
} throw Error('local_server_not_ready'); }
async function call(path, body) { const r = await fetch(`${api}/api/crm/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); assert.equal(r.ok, true, `API ${path} ${r.status}`); return r.json(); }
async function submit(html, field, values) { const form = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(x => x[0]).find(x => x.includes(`name="${field}"`)); assert.ok(form, `SSR form ${field}`); const action = form.match(/name="(\$ACTION_ID_[^"]+)"/); assert.ok(action, 'server action marker'); const data = new FormData(); for (const [k, v] of Object.entries({ [action[1]]: '', ...values }))
    data.set(k, v); const r = await fetch(`${web}/crm/booking-bot`, { method: 'POST', headers: { origin: web }, body: data, redirect: 'manual' }); assert.equal(r.status, 303, `server action ${field}`); return r.headers.get('location'); }
try {
    start(['--filter', 'worker', 'dev']);
    start(['--filter', 'web', 'exec', 'next', 'start', '--hostname', '127.0.0.1', '--port', '13005']);
    await Promise.all([ready(`${api}/api/health`), ready(`${web}/crm/booking-bot`)]);
    const startsAt = new Date(Date.now() + 2 * 86400000).toISOString(), endsAt = new Date(Date.now() + 2 * 86400000 + 3600000).toISOString();
    const slot = (await call('slots', { title: 'HTTP合成予約枠', startsAt, endsAt, capacity: 2 })).data;
    let html = await (await fetch(`${web}/crm/booking-bot?month=${startsAt.slice(0, 7)}`)).text();
    for (const content of ['Telegram Harness', 'HTTP合成予約枠', '電話の手入力受付', '予約確認・リマインダー', '実送信なし'])
        assert.ok(html.includes(content), content);
    assert.ok(!html.includes(key), 'management key absent from SSR');
    const calendarLocation = await submit(html, 'updateId', { botId: 'harness_demo', userId: '10001', displayName: 'HTTP合成', chatId: '-10001', chatType: 'supergroup', threadId: '7', updateId: '7000', command: '/book', callback: `cal:${startsAt.slice(0,7)}` });
    assert.ok(calendarLocation.includes(`month=${startsAt.slice(0,7)}`), 'calendar navigation follows callback month');
    const location = await submit(html, 'updateId', { botId: 'harness_demo', userId: '10001', displayName: 'HTTP合成', chatId: '-10001', chatType: 'supergroup', threadId: '7', updateId: '7001', command: '/book', callback: `book:${slot.id}` });
    assert.ok(decodeURIComponent(location).includes('予約を登録しました'), location);
    const bookings = (await call('bookings')).data;
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].customerId, 'tg:harness_demo:10001');
    const customer = (await call(`customers/${bookings[0].customerId}`)).data;
    assert.equal(customer.bookings.length, 1);
    const c = (await call('customers', { displayName: 'HTTP電話顧客', source: 'phone' })).data;
    const contact = (await call(`customers/${c.id}/contacts`, { kind: 'phone', value: '+819000000002' })).data;
    const phoneLocation = await submit(html, 'requestKey', { contactId: contact.id, slotId: slot.id, requestKey: 'http-phone-1', channel: 'sms' });
    assert.ok(decodeURIComponent(phoneLocation).includes('電話予約を登録しました'));
    const jobs = await call('booking-bot/notifications/run', {});
    assert.equal(jobs.data.filter(x => x.status === 'mocked').length, 1);
    assert.equal(jobs.data.filter(x => x.reason === 'unverified_contact').length, 1);
    html = await (await fetch(`${web}/crm/booking-bot`)).text();
    assert.ok(html.includes('mocked'));
    assert.ok(html.includes('unverified_contact'));
    const css = [...html.matchAll(/href="([^" ]+\.css[^" ]*)"/g)].map(x => x[1]);
    assert.ok(css.length > 0);
    for (const path of css)
        assert.equal((await fetch(new URL(path, web))).status, 200);
    console.log('PASS: localhost SSR + Next server actions → group/topic booking → ledger → phone intake → mock notifications; CSS 200; no browser; no live delivery.');
}
finally {
    for (const child of children)
        try {
            process.kill(-child.pid, 'SIGTERM');
        }
        catch { }
    await new Promise(r => setTimeout(r, 300));
    await rm(dir, { recursive: true, force: true });
}
