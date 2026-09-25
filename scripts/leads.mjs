#!/usr/bin/env node
/**
 * Lead tracker.
 *
 * Outreach is only reliable if you know what actually happened. This is a flat
 * JSON file on purpose: it survives, it is greppable, and it needs no database
 * or account for something you do five times a day.
 *
 * Usage:
 *   node scripts/leads.mjs add "Agency Name" --contact="..." --channel=dm \
 *        --value=1800000 --leads=18 --note="no whatsapp on listing page"
 *   node scripts/leads.mjs list
 *   node scripts/leads.mjs reply 3
 *   node scripts/leads.mjs stats
 */
import fs from 'node:fs';
import path from 'node:path';
import { price } from '../proposal/roi.mjs';

const FILE = path.resolve(process.env.LEADS_FILE || 'outreach/leads.json');

function load() {
  if (!fs.existsSync(FILE)) return { leads: [] };
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    // A corrupt tracker must never block outreach.
    fs.copyFileSync(FILE, `${FILE}.corrupt-${Date.now()}`);
    return { leads: [] };
  }
}

function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

const argv = process.argv.slice(2);
const [cmd, ...rest] = argv;
// Accepts both --key value and --key=value, because shell habits differ and a
// silently-ignored flag looks identical to a missing one.
const flag = (name, def = '') => {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
};

const db = load();
const today = () => new Date().toISOString().slice(0, 10);

switch (cmd) {
  case 'add': {
    if (!rest[0]) { console.error('Usage: add "Agency Name" [--contact=] [--channel=] [--note=]'); process.exit(1); }
    db.leads.push({
      id: db.leads.length + 1,
      agency: rest[0],
      contact: flag('contact'),
      channel: flag('channel', 'dm'),
      note: flag('note'),
      value: Number(flag('value', 0)) || null,
      leadsPerMonth: Number(flag('leads', 0)) || null,
      status: 'sent',
      created: today(),
      updates: [],
    });
    save(db);
    console.log(`added #${db.leads.length}: ${rest[0]}`);
    break;
  }

  case 'reply': {
    const id = Number(rest[0]);
    const lead = db.leads.find((l) => l.id === id);
    if (!lead) { console.error(`no lead #${id}`); process.exit(1); }
    lead.status = 'replied';
    lead.updates.push({ date: today(), note: flag('note', 'replied') });
    save(db);
    console.log(`#${id} ${lead.agency} -> replied`);
    if (lead.value && lead.leadsPerMonth) {
      const p = price({ inputs: { hoursPerWeek: 8, leadsPerMonth: lead.leadsPerMonth,
        baselineContactRate: 0.11, improvedContactRate: 0.19, closeRate: 0.2, dealValue: lead.value } });
      console.log(`  indicative: setup ${p.pricing.buildFee}, retainer ${p.pricing.monthlyRetainer}/mo`);
    }
    break;
  }

  case 'status': {
    const id = Number(rest[0]);
    const lead = db.leads.find((l) => l.id === id);
    if (!lead) { console.error(`no lead #${id}`); process.exit(1); }
    lead.status = rest[1];
    lead.updates.push({ date: today(), note: flag('note', rest[1]) });
    save(db);
    console.log(`#${id} -> ${rest[1]}`);
    break;
  }

  case 'list': {
    if (!db.leads.length) { console.log('No leads yet. Start with: node scripts/leads.mjs add "Agency" --leads=18 --value=1800000'); break; }
    for (const l of db.leads) {
      const mark = { sent: '·', replied: '→', qualified: '*', won: '+', lost: 'x' }[l.status] || '?';
      console.log(`  ${mark} #${l.id} ${l.agency.padEnd(28)} ${l.status.padEnd(10)} ${l.leadsPerMonth || '?'} leads/mo`);
    }
    break;
  }

  case 'stats': {
    const by = (s) => db.leads.filter((l) => l.status === s).length;
    const won = by('won');
    console.log(`total ${db.leads.length}  sent ${by('sent')}  replied ${by('replied')}  qualified ${by('qualified')}  won ${won}  lost ${by('lost')}`);
    const rate = db.leads.length ? ((by('replied') + won + by('qualified')) / db.leads.length) * 100 : 0;
    console.log(`engagement rate: ${rate.toFixed(0)}%`);
    if (db.leads.length < 20) console.log('note: under 20 sends, the rate is noise. Keep going before changing the message.');
    const retainer = won * 500;
    if (won) console.log(`retainer floor at 500/mo per client: ${retainer}/mo`);
    break;
  }

  default:
    console.log('Usage: leads.mjs <add|list|reply|status|stats>');
}
