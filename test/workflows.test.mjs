import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WF = path.join(HERE, '..', 'n8n', 'workflows');

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(WF, `${name}.json`), 'utf8'));
}

/** Run a Code node's jsCode against a fake n8n $input, like n8n itself would. */
function runCode(workflow, nodeName, inputItems) {
  const node = workflow.nodes.find((n) => n.name === nodeName);
  assert.ok(node, `node "${nodeName}" not found`);
  assert.equal(node.type, 'n8n-nodes-base.code', `${nodeName} is not a Code node`);

  const $input = {
    all: () => inputItems,
    first: () => inputItems[0],
  };
  // n8n Code nodes are async-capable and receive $input/$json in scope.
  const ctx = vm.createContext({ $input, $: { json: inputItems[0]?.json ?? {} }, console });
  return vm.runInContext(`(async () => { ${node.parameters.jsCode} })()`, ctx);
}

test('all demo workflows exist and are valid JSON with required keys', () => {
  const files = fs.readdirSync(WF).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 3, 'expected at least 3 demo workflows');
  for (const f of files) {
    const w = JSON.parse(fs.readFileSync(path.join(WF, f), 'utf8'));
    for (const key of ['name', 'nodes', 'connections']) {
      assert.ok(w[key] !== undefined, `${f} missing "${key}"`);
    }
    assert.ok(Array.isArray(w.nodes) && w.nodes.length > 0, `${f} has no nodes`);
  }
});

test('every connection references a real node', () => {
  for (const f of fs.readdirSync(WF).filter((x) => x.endsWith('.json'))) {
    const w = load(f.replace('.json', ''));
    const names = new Set(w.nodes.map((n) => n.name));
    for (const [from, conn] of Object.entries(w.connections)) {
      assert.ok(names.has(from), `${w.name}: dangling source "${from}"`);
      for (const branch of conn.main) {
        for (const t of branch) {
          assert.ok(names.has(t.node), `${w.name}: dangling target "${t.node}"`);
        }
      }
    }
  }
});

test('no demo workflow is pre-activated', () => {
  for (const f of fs.readdirSync(WF).filter((x) => x.endsWith('.json'))) {
    const w = load(f.replace('.json', ''));
    assert.equal(w.active, false, `${w.name} must ship inactive`);
  }
});

test('lead scoring: hot lead (1.5M budget, 14 days, pre-approved) scores 100', async () => {
  const w = load('demo-01-instant-lead-response');
  const out = await runCode(w, 'Score Lead', [{
    json: { body: { email: 'a@b.com', budget: 1_500_000, timelineDays: 14, preApproved: true, phone: '+971500000000' } },
  }]);
  const { score, priority } = out[0].json.lead;
  assert.equal(score, 100);
  assert.equal(priority, 'hot');
});

test('lead scoring: cold lead (no budget, no timeline) scores low and is not hot', async () => {
  const w = load('demo-01-instant-lead-response');
  const out = await runCode(w, 'Score Lead', [{ json: { body: { email: 'c@d.com' } } }]);
  const { score, priority } = out[0].json.lead;
  assert.ok(score < 45, `expected cold score, got ${score}`);
  assert.equal(priority, 'cold');
});

test('lead scoring: budget alone is not enough for hot', async () => {
  const w = load('demo-01-instant-lead-response');
  const out = await runCode(w, 'Score Lead', [{
    json: { body: { email: 'e@f.com', budget: 2_000_000, timelineDays: 365, preApproved: false } },
  }]);
  assert.notEqual(out[0].json.lead.priority, 'hot');
});

test('lead scoring never returns NaN for junk input', async () => {
  const w = load('demo-01-instant-lead-response');
  const out = await runCode(w, 'Score Lead', [{
    json: { body: { email: 'g@h.com', budget: 'abc', timelineDays: null, preApproved: 'yes' } },
  }]);
  const { score } = out[0].json.lead;
  assert.ok(Number.isFinite(score), `score was ${score}`);
});

test('lead scoring handles multiple leads in one execution', async () => {
  const w = load('demo-01-instant-lead-response');
  const out = await runCode(w, 'Score Lead', [
    { json: { body: { email: '1@x.com', budget: 1_200_000, timelineDays: 10, preApproved: true, phone: '+971' } } },
    { json: { body: { email: '2@x.com' } } },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].json.lead.priority, 'hot');
  assert.equal(out[1].json.lead.priority, 'cold');
});

test('follow-up cadence escalates and every step is cancellable', async () => {
  const w = load('demo-02-missed-enquiry-followup');
  const out = await runCode(w, 'Build Follow-up Schedule', [{
    json: { body: { phone: '+971500000000', name: 'Sara', channel: 'whatsapp' } },
  }]);
  assert.ok(out.length >= 3, 'expected multiple follow-up steps');
  const times = out.map((o) => new Date(o.json.sendAt).getTime()).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] > times[i - 1], 'send times must be strictly increasing');
  }
  for (const o of out) {
    assert.ok(o.json.cancelIf, 'every follow-up must carry a cancel condition');
    assert.ok(o.json.messageAr && o.json.messageEn, 'both AR and EN copy required');
  }
});

test('follow-up escapes user input so a name cannot break the template', async () => {
  const w = load('demo-02-missed-enquiry-followup');
  const out = await runCode(w, 'Build Follow-up Schedule', [{
    json: { body: { phone: '+971500000000', name: '${1+1}', channel: 'whatsapp' } },
  }]);
  assert.equal(typeof out[0].json.messageEn, 'string');
  assert.ok(out[0].json.messageEn.includes('${1+1}'));
});

test('viewing reminders fire before the viewing and are cancellable', async () => {
  const w = load('demo-03-viewing-confirmation');
  const viewingAt = new Date(Date.now() + 48 * 3600_000).toISOString();
  const out = await runCode(w, 'Build Reminders', [{
    json: { body: { phone: '+971500000000', name: 'Omar', property: 'Marina Villa', viewingAt } },
  }]);
  assert.ok(out.length >= 2);
  for (const o of out) {
    assert.ok(new Date(o.json.sendAt) < new Date(viewingAt), 'reminder must precede the viewing');
    assert.equal(o.json.requiresCancel, true);
  }
});

test('viewing reminders surface an error item on a bad date instead of throwing', async () => {
  const w = load('demo-03-viewing-confirmation');
  const out = await runCode(w, 'Build Reminders', [{
    json: { body: { phone: '+9715', viewingAt: 'not-a-date' } },
  }]);
  assert.equal(out.length, 1);
  assert.ok(out[0].json.error, 'expected an error item, not an exception');
});

test('every demo ships AR and EN message copy', () => {
  for (const f of ['demo-02-missed-enquiry-followup', 'demo-03-viewing-confirmation']) {
    const w = load(f);
    const code = w.nodes.find((n) => n.type === 'n8n-nodes-base.code');
    assert.match(code.parameters.jsCode, /messageAr/, `${f} missing Arabic copy`);
    assert.match(code.parameters.jsCode, /messageEn/, `${f} missing English copy`);
  }
});
