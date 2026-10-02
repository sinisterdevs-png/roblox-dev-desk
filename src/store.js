import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, '..', 'data');
const file = path.join(dataDir, 'store.json');
const initial = { products: [], submissions: [], settings: { communityName: 'Roblox Dev Desk', welcome: 'Submit your Roblox products for owner review.' } };
fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(initial, null, 2));
let state = JSON.parse(fs.readFileSync(file, 'utf8'));
function save() {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, file);
}
export const db = {
  all: () => state,
  products: (includeArchived = false) => state.products.filter(p => includeArchived || (p.status === 'published')),
  product: id => state.products.find(p => p.id === id),
  upsertProduct(input) {
    const now = new Date().toISOString();
    const previous = input.id ? this.product(input.id) : null;
    const product = { title: '', category: 'Other', summary: '', robloxUrl: '', assetType: 'Experience', price: 'Free', status: 'draft', criteria: [], questions: [], createdAt: previous?.createdAt ?? now, ...previous, ...input, id: previous?.id ?? crypto.randomUUID(), updatedAt: now };
    if (previous) state.products[state.products.indexOf(previous)] = product; else state.products.unshift(product);
    save(); return product;
  },
  submission: id => state.submissions.find(s => s.id === id),
  createSubmission(input) { const submission = { id: crypto.randomUUID(), status: 'pending', createdAt: new Date().toISOString(), reviewerId: '', reviewerNote: '', decisionNote: '', ...input }; state.submissions.unshift(submission); save(); return submission; },
  updateSubmission(id, patch) { const item = this.submission(id); if (!item) return null; Object.assign(item, patch, { updatedAt: new Date().toISOString() }); save(); return item; },
  setSettings(patch) { state.settings = { ...state.settings, ...patch }; save(); return state.settings; }
};
