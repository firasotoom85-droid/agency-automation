#!/usr/bin/env node
/**
 * Generates the three demo workflows as n8n-importable JSON.
 *
 * Generated rather than hand-written because hand-authored n8n JSON rots: node
 * type versions and parameter shapes change between releases, and a demo that
 * fails to import on the client's version is worse than no demo at all.
 *
 * All three run with zero credentials. That is deliberate: a prospect can
 * import, activate and watch it work before we ever ask for a Twilio key or a
 * CRM login. The last step of each is a no-op placeholder that is where the
 * real integration goes.
 */

import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || 'n8n/workflows');
fs.mkdirSync(OUT, { recursive: true });

const pos = (y) => [0, y];

function wf({ name, nodes, connections, settings = {} }) {
  return {
    name,
    nodes,
    connections,
    active: false,
    settings,
    versionId: 'demo-1',
    meta: { instanceId: 'demo' },
    tags: [],
    pinData: {},
  };
}

const n = (name, type, parameters, position, extra = {}) => ({
  parameters,
  name,
  type,
  typeVersion: extra.typeVersion ?? 1,
  position,
  ...extra,
});

// ---------------------------------------------------------------------------
// Demo 1 — Instant lead response
//
// The core pitch: response time drives contact rate. This receives a lead,
// scores it, and routes a reply. Runs with no credentials.
// ---------------------------------------------------------------------------
const leadResponse = wf({
  name: 'demo-01-instant-lead-response',
  nodes: [
    n('Webhook', 'n8n-nodes-base.webhook', {
      httpMethod: 'POST',
      path: 'lead',
      responseMode: 'lastNode',
      responseData: 'allEntries',
      options: {},
    }, pos(-360)),
    n('Validate Lead', 'n8n-nodes-base.if', {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{
          id: 'has-email',
          leftValue: '={{ $json.body.email }}',
          rightValue: '',
          operator: { type: 'string', operation: 'notEmpty' },
        }],
        combinator: 'and',
      },
      options: {},
    }, pos(-120), { typeVersion: 2 }),
    n('Score Lead', 'n8n-nodes-base.code', {
      mode: 'runOnceForAllItems',
      jsCode: `// Score on the signals an agent can act on: budget, timeline, pre-approval.
// Weights sum to exactly 100 so the priority bands below mean what they say.
// A score outside 0-100 breaks the "top 7% of leads" framing we show clients.
const leads = [];
for (const item of $input.all()) {
  const b = item.json.body || {};
  const budget = Number(b.budget) || 0;
  const timelineDays = Number(b.timelineDays) || 999;

  let score = 0;
  if (budget >= 1_000_000) score += 35;
  else if (budget >= 500_000) score += 20;
  else score += 8;

  if (timelineDays <= 30) score += 25;
  else if (timelineDays <= 90) score += 12;

  if (b.preApproved === true || b.preApproved === 'true') score += 25;
  if (b.phone) score += 15;

  score = Math.min(100, score);
  const priority = score >= 70 ? 'hot' : score >= 45 ? 'warm' : 'cold';

  leads.push({ json: { ...item.json, lead: { ...b, score, priority } } });
}
return leads;`,
    }, pos(120)),
    n('Route by Priority', 'n8n-nodes-base.switch', {
      rules: {
        values: [
          { conditions: { options: { caseSensitive: true, typeValidation: 'loose' }, conditions: [{ id: 'is-hot', leftValue: '={{ $json.lead.priority }}', rightValue: 'hot', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: 'Hot' },
          { conditions: { options: { caseSensitive: true, typeValidation: 'loose' }, conditions: [{ id: 'is-warm', leftValue: '={{ $json.lead.priority }}', rightValue: 'warm', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: 'Warm' },
        ],
      },
      options: { fallbackOutput: 'extra' },
    }, pos(360), { typeVersion: 3 }),
    n('Notify Agent (placeholder)', 'n8n-nodes-base.noOp', {}, pos(600), {
      notes: 'REPLACE WITH DELIVERY: WhatsApp Business API, SMS via Twilio, or the agency CRM. The reply must go out in under 5 minutes to beat the response-time advantage.',
    }),
  ],
  connections: {
    Webhook: { main: [[{ node: 'Validate Lead', type: 'main', index: 0 }]] },
    'Validate Lead': { main: [[{ node: 'Score Lead', type: 'main', index: 0 }], []] },
    'Score Lead': { main: [[{ node: 'Route by Priority', type: 'main', index: 0 }]] },
    'Route by Priority': { main: [[{ node: 'Notify Agent (placeholder)', type: 'main', index: 0 }]] },
  },
});

// ---------------------------------------------------------------------------
// Demo 2 — Missed-call / enquiry follow-up
//
// The cheapest ROI in the whole offering: a 4-hour delay on a hot lead is the
// single most expensive thing a small agency does. Zero credentials.
// ---------------------------------------------------------------------------
const followUp = wf({
  name: 'demo-02-missed-enquiry-followup',
  nodes: [
    n('Enquiry Webhook', 'n8n-nodes-base.webhook', {
      httpMethod: 'POST', path: 'enquiry', responseMode: 'lastNode', responseData: 'allEntries', options: {},
    }, pos(-360)),
    n('Build Follow-up Schedule', 'n8n-nodes-base.code', {
      mode: 'runOnceForAllItems',
      jsCode: `// Sequence: 5 min -> 1 hour -> 4 hours -> next morning. Stops on reply.
const CADENCES_MIN = [5, 60, 240];
const out = [];

for (const item of $input.all()) {
  const b = item.json.body || {};
  const now = Date.now();

  for (const minutes of CADENCES_MIN) {
    out.push({
      json: {
        channel: b.channel || 'whatsapp',
        to: b.phone || b.to,
        name: b.name || 'there',
        step: minutes,
        sendAt: new Date(now + minutes * 60_000).toISOString(),
        // Cancel condition: if the prospect replied, stop the sequence.
        cancelIf: \`replyFrom:\${b.phone || b.to} received before \${new Date(now + minutes * 60_000).toISOString()}\`,
        messageAr: \`مرحبًا \${b.name || ''}، شكرًا لتواصلك معنا. هل ما زلت تبحث عن عقار؟\`,
        messageEn: \`Hi \${b.name || 'there'}, thanks for reaching out. Are you still looking?\`,
      },
    });
  }
}
return out;`,
    }, pos(-120)),
    n('Wait (demo: short)', 'n8n-nodes-base.wait', {
      amount: 5, unit: 'seconds',
    }, pos(120)),
    n('Log Scheduled Message', 'n8n-nodes-base.noOp', {}, pos(360), {
      notes: 'REPLACE WITH DELIVERY: WhatsApp Business API template message, or SMS. The cancelIf condition must be enforced by the channel, not by us, or the prospect gets four messages after replying.',
    }),
  ],
  connections: {
    'Enquiry Webhook': { main: [[{ node: 'Build Follow-up Schedule', type: 'main', index: 0 }]] },
    'Build Follow-up Schedule': { main: [[{ node: 'Wait (demo: short)', type: 'main', index: 0 }]] },
    'Wait (demo: short)': { main: [[{ node: 'Log Scheduled Message', type: 'main', index: 0 }]] },
  },
});

// ---------------------------------------------------------------------------
// Demo 3 — Viewing confirmation and no-show reduction
//
// Healthcare/e-commerce priced niches care most about no-shows. Zero credentials.
// ---------------------------------------------------------------------------
const noShow = wf({
  name: 'demo-03-viewing-confirmation',
  nodes: [
    n('Booking Webhook', 'n8n-nodes-base.webhook', {
      httpMethod: 'POST', path: 'booking', responseMode: 'lastNode', responseData: 'allEntries', options: {},
    }, pos(-360)),
    n('Build Reminders', 'n8n-nodes-base.code', {
      mode: 'runOnceForAllItems',
      jsCode: `// Reminder ladder before the viewing time. Each one is cancellable.
const out = [];
for (const item of $input.all()) {
  const b = item.json.body || {};
  const viewingAt = new Date(b.viewingAt);
  if (Number.isNaN(viewingAt.getTime())) {
    out.push({ json: { error: 'viewingAt is missing or invalid', body: b } });
    continue;
  }

  // 24h before, and 2h before.
  for (const hoursBefore of [24, 2]) {
    const sendAt = new Date(viewingAt.getTime() - hoursBefore * 3600_000);
    out.push({
      json: {
        to: b.phone,
        name: b.name,
        property: b.property,
        viewingAt: viewingAt.toISOString(),
        hoursBefore,
        sendAt: sendAt.toISOString(),
        requiresCancel: true,
        messageAr: \`تذكير: موعدك لزيارة \${b.property} غدًا. للتأكيد رد بكلمة نعم، للإلغاء رد بكلمة إلغاء.\`,
        messageEn: \`Reminder: your viewing of \${b.property} is coming up. Reply YES to confirm, CANCEL to reschedule.\`,
      },
    });
  }
}
return out;`,
    }, pos(-120)),
    n('Send Reminder (placeholder)', 'n8n-nodes-base.noOp', {}, pos(120), {
      notes: 'REPLACE WITH DELIVERY: WhatsApp or SMS. Track replies so a confirmed viewing suppresses the second reminder.',
    }),
  ],
  connections: {
    'Booking Webhook': { main: [[{ node: 'Build Reminders', type: 'main', index: 0 }]] },
    'Build Reminders': { main: [[{ node: 'Send Reminder (placeholder)', type: 'main', index: 0 }]] },
  },
});

const all = [leadResponse, followUp, noShow];

for (const w of all) {
  const file = path.join(OUT, `${w.name}.json`);
  fs.writeFileSync(file, JSON.stringify(w, null, 2));
  console.log(`wrote ${file}  (${w.nodes.length} nodes, ${Object.keys(w.connections).length} connection groups)`);
}

// Structural validation: a typo in a node reference silently breaks import.
let bad = 0;
for (const w of all) {
  const names = new Set(w.nodes.map((x) => x.name));
  for (const [from, conn] of Object.entries(w.connections)) {
    if (!names.has(from)) {
      console.error(`  BROKEN: ${w.name} connects from unknown node "${from}"`);
      bad++;
    }
    for (const branch of conn.main) {
      for (const target of branch) {
        if (!names.has(target.node)) {
          console.error(`  BROKEN: ${w.name} targets unknown node "${target.node}"`);
          bad++;
        }
      }
    }
  }
}
if (bad) { console.error(`\n${bad} broken connection reference(s).`); process.exit(1); }
console.log('\nAll workflow connection references validated.');
