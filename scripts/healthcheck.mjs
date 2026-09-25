#!/usr/bin/env node
/**
 * Delivery health monitor.
 *
 * This is the part that decides whether a client renews. A workflow that fails
 * silently costs you the retainer; the client finds out from their own customer,
 * not from you. So: check every workflow's recent executions, and shout when
 * something is broken.
 *
 * Usage:
 *   N8N_API_KEY=xxx node scripts/healthcheck.mjs
 *   N8N_API_KEY=xxx node scripts/healthcheck.mjs --json
 *
 * Reads the n8n REST API. Returns non-zero exit when any client workflow is
 * failing, so it can drive a cron job or a systemd timer.
 */

const BASE = process.env.N8N_BASE_URL || 'http://127.0.0.1:5678';
const KEY = process.env.N8N_API_KEY;
const asJson = process.argv.includes('--json');
const FAILURE_THRESHOLD = Number(process.env.FAILURE_THRESHOLD || 1);
const LOOKBACK_HOURS = Number(process.env.LOOKBACK_HOURS || 24);

if (!KEY) {
  console.error('N8N_API_KEY is required. Create one in n8n: Settings > n8n API > Create API key.');
  process.exit(2);
}

async function api(path) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    headers: { 'X-N8N-API-KEY': KEY, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`n8n API ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Only production workflows are client-facing. Skip personal/dev ones. */
function isClientWorkflow(wf) {
  return Boolean(wf.active) && !/^(test|demo|sandbox)/i.test(wf.name);
}

async function collect() {
  const { data: workflows } = await api('/workflows?limit=100');
  const clientWfs = workflows.filter(isClientWorkflow);

  const since = Date.now() - LOOKBACK_HOURS * 3600 * 1000;
  const report = [];

  for (const wf of clientWfs) {
    const url =
      `/executions?workflowId=${wf.id}&status=error&limit=20` +
      `&filter={"startedAfter":${new Date(since).toISOString()}}`;

    let failures = 0;
    let lastError = null;
    try {
      const { data: execs } = await api(url);
      failures = execs.length;
      lastError = execs[0]?.stopped?.error?.message || null;
    } catch (e) {
      report.push({
        workflow: wf.name, id: wf.id, status: 'unknown',
        detail: `Could not read executions: ${e.message}`,
      });
      continue;
    }

    // An active workflow that has never run is usually a broken trigger,
    // not a healthy idle system. Flag it so it gets noticed.
    const { data: all } = await api(`/executions?workflowId=${wf.id}&limit=1`);
    const neverRun = all.length === 0;

    report.push({
      workflow: wf.name,
      id: wf.id,
      status: failures >= FAILURE_THRESHOLD ? 'failing' : neverRun ? 'never-run' : 'ok',
      failures,
      lastError,
    });
  }

  return report;
}

const report = await collect();
const bad = report.filter((r) => r.status === 'failing' || r.status === 'unknown');
const never = report.filter((r) => r.status === 'never-run');

if (asJson) {
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), workflows: report, healthy: bad.length === 0 }, null, 2));
} else if (report.length === 0) {
  console.log('No active client workflows found. Is this the right instance?');
} else {
  const icon = { ok: 'OK  ', 'never-run': 'WARN', failing: 'FAIL', unknown: 'FAIL' };
  console.log(`Workflow health — last ${LOOKBACK_HOURS}h (${report.length} client workflows)\n`);
  for (const r of report) {
    console.log(`  [${icon[r.status]}] ${r.workflow}`);
    if (r.lastError) console.log(`         ${r.lastError.slice(0, 140)}`);
    if (r.detail) console.log(`         ${r.detail.slice(0, 140)}`);
  }
  if (never.length) console.log(`\n  ${never.length} active workflow(s) have never executed. Check their triggers.`);
  console.log(`\n${bad.length === 0 ? 'All client workflows healthy.' : `${bad.length} workflow(s) need attention.`}`);
}

// A live client with a broken workflow is a retention risk, so this fails hard.
process.exit(bad.length > 0 ? 1 : 0);
