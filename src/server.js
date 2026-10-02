import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { db } from './store.js';
import { startDiscord, sendDecision } from './discord.js';

const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DASHBOARD_USER', 'DASHBOARD_PASSWORD', 'SESSION_SECRET', 'OWNER_IDS'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) throw new Error(`Missing required .env settings: ${missing.join(', ')}`);
if (process.env.DASHBOARD_PASSWORD.length < 16 || process.env.SESSION_SECRET.length < 32) throw new Error('Use a dashboard password of at least 16 characters and SESSION_SECRET of at least 32 characters.');
const app = express();
const client = startDiscord();
const staticDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"], imgSrc: ["'self'", 'https:', 'data:'], connectSrc: ["'self'"] } } }));
app.use(express.json({ limit: '256kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));

function safeEqual(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function auth(req, res, next) {
  const value = req.headers.authorization ?? '';
  if (!value.startsWith('Basic ')) { res.set('WWW-Authenticate', 'Basic realm="Roblox Dev Desk"'); return res.status(401).send('Owner sign-in required.'); }
  let decoded = ''; try { decoded = Buffer.from(value.slice(6), 'base64').toString('utf8'); } catch {}
  const split = decoded.indexOf(':');
  if (split < 0 || !safeEqual(decoded.slice(0, split), process.env.DASHBOARD_USER) || !safeEqual(decoded.slice(split + 1), process.env.DASHBOARD_PASSWORD)) return res.status(401).send('Incorrect dashboard credentials.');
  next();
}
function sameOrigin(req, res, next) {
  const site = req.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) return res.status(403).json({ error: 'Cross-site request blocked.' });
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Cross-site request blocked.' });
  next();
}
app.use(auth, sameOrigin);
app.get('/api/state', (req, res) => res.json({ ...db.all(), botConnected: client.isReady(), hasSubmissionChannel: Boolean(process.env.SUBMISSIONS_CHANNEL_ID) }));
app.get('/api/submissions/:id', (req, res) => { const submission = db.submission(req.params.id); return submission ? res.json(submission) : res.status(404).json({ error: 'Submission not found.' }); });
app.put('/api/settings', (req, res) => res.json(db.setSettings({ communityName: clean(req.body.communityName, 70), welcome: clean(req.body.welcome, 300) })));
app.post('/api/products', (req, res) => {
  const body = req.body ?? {};
  if (!clean(body.title, 80)) return res.status(400).json({ error: 'Product name is required.' });
  const product = db.upsertProduct({ ...body, title: clean(body.title, 80), category: clean(body.category, 40) || 'Other', summary: clean(body.summary, 300), robloxUrl: safeUrl(body.robloxUrl), assetType: clean(body.assetType, 40), price: clean(body.price, 80), status: ['draft', 'published', 'archived'].includes(body.status) ? body.status : 'draft', criteria: list(body.criteria, 12, 140), questions: (Array.isArray(body.questions) ? body.questions : []).slice(0, 5).map(q => ({ label: clean(q.label, 45), long: Boolean(q.long), required: q.required !== false })).filter(q => q.label) });
  res.json(product);
});
app.patch('/api/submissions/:id', async (req, res) => {
  const current = db.submission(req.params.id); if (!current) return res.status(404).json({ error: 'Submission not found.' });
  const status = req.body.status;
  if (status && !['pending', 'in_review', 'changes_requested', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid review status.' });
  const item = db.updateSubmission(current.id, { ...(status ? { status } : {}), ...(req.body.reviewerId !== undefined ? { reviewerId: clean(req.body.reviewerId, 32) } : {}), ...(req.body.reviewerNote !== undefined ? { reviewerNote: clean(req.body.reviewerNote, 3000) } : {}), ...(req.body.decisionNote !== undefined ? { decisionNote: clean(req.body.decisionNote, 1000) } : {}) });
  if (status && status !== current.status && ['changes_requested', 'approved', 'rejected'].includes(status)) await sendDecision(client, item, item.reviewerId || process.env.OWNER_IDS.split(',')[0].trim(), item.decisionNote);
  res.json(item);
});
app.use(express.static(staticDir, { maxAge: '1h', etag: true }));
app.get('*path', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Unexpected server error.' }); });
function clean(value, max) { return String(value ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max); }
function list(value, count, max) { return (Array.isArray(value) ? value : String(value ?? '').split('\n')).map(x => clean(x, max)).filter(Boolean).slice(0, count); }
function safeUrl(value) { try { const u = new URL(String(value)); return ['https:', 'http:'].includes(u.protocol) ? u.toString().slice(0, 300) : ''; } catch { return ''; } }
const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => console.log(`Roblox Dev Desk dashboard listening on ${port}`));
