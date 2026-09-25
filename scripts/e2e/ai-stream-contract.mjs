/** Real client + compiled AiService over local HTTP, with a deterministic AI provider. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { AiService } = require('../../server/dist/ai/ai.service.js');
const originalFetch = globalThis.fetch;
let mode = 'valid';
let passed = 0;
const d = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\r\n\r\n`;
const provider = http.createServer(async (req, res) => {
  for await (const _ of req) { /* consume request */ }
  if (mode === 'http-error') { res.writeHead(503); res.end('unavailable'); return; }
  if (mode === 'json' || mode === 'empty-json') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: mode === 'json' ? 'پاسخ کامل' : '' } }] }));
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  if (mode === 'empty') { res.end('data: [DONE]\n\n'); return; }
  if (mode === 'provider-error') { res.end('data: {"error":{"message":"upstream failed"}}\n\n'); return; }
  if (mode === 'malformed') { res.end('data: {broken}\n\n'); return; }
  if (mode === 'truncated') { res.end(d('نیمه')); return; }
  if (mode === 'length') { res.end(d('نیمه') + 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'); return; }
  // Split UTF-8 and event boundaries, as a network connection can.
  const bytes = Buffer.from(d('شرح فارسی') + 'data: [DONE]\r\n\r\n');
  for (let i = 0; i < bytes.length; i += 7) { res.write(bytes.subarray(i, i + 7)); await delay(1); }
  if (mode === 'hold-open') { const timer = setTimeout(() => res.end(), 10000); res.on('close', () => clearTimeout(timer)); }
  else res.end();
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const cfg = { enabled: true, baseUrl: `http://127.0.0.1:${provider.address().port}`, apiKey: 'local-only', models: { chat: 'fixture' }, prompts: {} };
const ai = new AiService({ patient: { findFirst: async () => ({ id: 1 }) }, clinicalNote: { findMany: async () => [] }, aiFeedback: { findMany: async () => [] } }, { ai: async () => cfg }, {});
const proxy = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  if (req.url === '/api/crlf') { res.setHeader('Content-Type', 'text/event-stream'); res.end('data:{"d":"متن"}\r\n\r\ndata:[DONE]\r\n\r\n'); return; }
  if (req.url === '/api/eof') { res.setHeader('Content-Type', 'text/event-stream'); res.end('data: {"d":"نیمه"}\n\n'); return; }
  if (req.url === '/api/401') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"message":["ورود لازم است"]}'); return; }
  try { await ai.noteDraftStream({ level: 6 }, JSON.parse(body), res); }
  catch (e) { res.writeHead(e.getStatus?.() ?? 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: e.message })); }
});
await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
globalThis.window = new EventTarget();
window.location = { origin: `http://127.0.0.1:${proxy.address().port}` };
globalThis.sessionStorage = { getItem: () => 'test-only' };
globalThis.localStorage = { getItem: () => null };
const source = (await readFile(new URL('../../src/lib/api.js', import.meta.url), 'utf8')).replace('import.meta.env.VITE_API_BASE', 'undefined');
const { apiStream, ApiError } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const dto = { patientId: 1, kind: 'visit', text: 'شرح خام', mode: 'structure' };
const run = async (path = '/draft') => { let out = ''; await apiStream(path, dto, (part) => { out += part; }); return out; };
try {
  for (const current of ['valid', 'json', 'hold-open']) {
    mode = current;
    const start = Date.now();
    assert.equal(await run(), current === 'json' ? 'پاسخ کامل' : 'شرح فارسی');
    assert.ok(Date.now() - start < 5000, 'DONE ends even if provider keeps connection open');
    console.log(`PASS ${++passed}: ${mode}`);
  }
  for (const current of ['empty', 'empty-json', 'provider-error', 'malformed', 'truncated', 'length', 'http-error']) {
    mode = current;
    await assert.rejects(run(), (e) => e instanceof ApiError && e.status === 502);
    console.log(`PASS ${++passed}: ${mode} is an error, never successful empty output`);
  }
  assert.equal(await run('/crlf'), 'متن'); console.log(`PASS ${++passed}: client accepts CRLF and data without optional space`);
  await assert.rejects(run('/eof'), ApiError); console.log(`PASS ${++passed}: client rejects missing DONE`);
  let unauthorized = 0; window.addEventListener('amalyar:unauthorized', () => unauthorized++);
  await assert.rejects(run('/401'), (e) => e.status === 401 && e.message === 'ورود لازم است');
  assert.equal(unauthorized, 1); console.log(`PASS ${++passed}: expired login uses shared recovery event`);
  globalThis.fetch = async () => { throw new TypeError('network failed'); };
  await assert.rejects(run(), (e) => e instanceof ApiError && e.status === 0);
  console.log(`PASS ${++passed}: network error is readable`);
  console.log(`${passed} stream contract checks passed`);
} finally {
  globalThis.fetch = originalFetch;
  proxy.closeAllConnections(); proxy.close();
  provider.closeAllConnections(); provider.close();
}
