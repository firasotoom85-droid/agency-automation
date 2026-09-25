# Automation delivery stack

Everything needed to sell, price and deliver automation retainers to
Gulf-focused small and mid-size agencies.

**Live site:** https://firasotoom85-droid.github.io/agency-automation/
(Arabic: `/ar/` · English: `/en/`)

---

## What is here

| Path | What it does |
|---|---|
| `proposal/roi.mjs` | Value-based pricing engine. Turns discovery numbers into a defensible price and flags implausible quotes. |
| `proposal/generate.mjs` | Renders a bilingual (AR/EN) proposal as Markdown + print-ready HTML. |
| `n8n/docker-compose.yml` | Self-hosted n8n + Postgres, memory-capped, loopback-only. |
| `n8n/workflows/` | Three importable demo workflows, all runnable with no API keys. |
| `scripts/healthcheck.mjs` | Polls the n8n API and exits non-zero when a client workflow is failing. |
| `scripts/gen-workflows.mjs` | Regenerates the demo workflow JSON and validates node references. |
| `scripts/leads.mjs` | Flat-file lead tracker. No database, no account. |
| `outreach/messages.md` | Outbound sequences in AR/EN, discovery-call questions, pricing guidance. |
| `test/` | 33 tests covering pricing math and workflow logic. |

---

## Quick start

```bash
# 1. Pricing — see what a deal is worth
node proposal/generate.mjs --demo --out out/

# 2. Real discovery data
node proposal/generate.mjs --input discovery.json --out out/
#    discovery.json: { client, currency: "AED", inputs: {
#      hoursPerWeek, automationRate, leadsPerMonth,
#      baselineContactRate, improvedContactRate, closeRate, dealValue, confidence }}

# 3. Delivery stack
cd n8n && cp .env.example .env     # then set the two secrets
docker compose up -d
curl http://127.0.0.1:5678/healthz

# 4. Health
N8N_API_KEY=xxx node scripts/healthcheck.mjs

# 5. Outreach
node scripts/leads.mjs add "Agency Name" --leads=18 --value=900000
node scripts/leads.mjs stats
```

Tests: `node --test test/`

---

## Two things that will bite you if you skip them

**1. n8n is bound to `127.0.0.1` and must stay there.** It has no auth
configured until an owner account exists, and it stores every client's
credentials in its database. Put it behind a TLS reverse proxy with real
authentication. Never expose the raw port.

**2. `N8N_ENCRYPTION_KEY` decrypts every stored client credential.** Generate it
with `openssl rand -hex 32`, commit only `.env.example`, and back the key up
somewhere the client cannot reach. Lose it and every stored credential must be
re-entered by hand.

---

## How pricing works

Clients buy recovered time and won revenue, not hours. So:

```
recovered hours/month  = hoursPerWeek x automationRate x 52 / 12
incremental appointments = leadsPerMonth x (new contact rate - old contact rate)
incremental deals       = incremental appointments x closeRate
annual value            = labour value + (incremental deals x dealValue x confidence x 12)
setup fee               = 10% of annual value
monthly retainer        = 15% of the setup fee
```

Two deliberate choices:

- **`closeRate` is mandatory.** Without it the model treats every contacted lead
  as a closed sale, which on 18 leads/month and a AED 900k average deal produces
  a AED 12M "savings" claim. A proposal like that loses the deal on the first
  call.
- **The model flags implausible numbers and the generator exits non-zero.**
  A quote that cannot survive a sceptical CFO should never leave the building.

Confidence defaults to `0.8` — the number is a haircut, not a promise.

---

## The part this repo cannot do

**Finding clients.** Code is roughly 30% of this business; outreach is the
other 70%. The research behind this is consistent: solo digital products
mostly reach zero revenue, while productized services land first clients in
2–4 weeks and become recurring from month one.

Send 5 personalised messages a weekday, from `outreach/messages.md`, and track
them in `scripts/leads.mjs`. Every `[FILL]` must be filled with something real.
That is the actual job.

---

## Security notes

- `.env` is gitignored. Only `.env.example` is tracked. Verify with
  `git ls-files | grep '\.env$'` — it must print nothing.
- Per-client isolation happens at the n8n **project** level, not in the compose
  file. Create a separate project per client before real data lands.
- The demo workflows contain no credentials and ship inactive. The final node in
  each is a `NoOp` placeholder marking exactly where a real integration
  (WhatsApp, Twilio, CRM) goes.
- `scripts/healthcheck.mjs` exits non-zero on failure, so it belongs in cron or
  a systemd timer. A silently broken workflow is how you lose a retainer.
