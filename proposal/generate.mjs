#!/usr/bin/env node
/**
 * Generates a client-facing proposal (Markdown + HTML) from discovery inputs.
 *
 * Usage:
 *   node proposal/generate.mjs --input discovery.json --out out/
 *   node proposal/generate.mjs --demo --out out/
 *
 * Arabic is rendered RTL with proper lang/dir so it survives being pasted into
 * Word, WhatsApp or a browser without reflowing into gibberish.
 */
import fs from 'node:fs';
import path from 'node:path';
import { price, CURRENCIES } from './roi.mjs';

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

function toArabicDigits(str) {
  return String(str).replace(/[0-9]/g, (d) => ARABIC_DIGITS[+d]);
}

function money(n, currency) {
  const rounded = Math.round(n);
  return `${CURRENCIES[currency].symbol} ${rounded.toLocaleString('en-US')}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function hours(n) {
  return `${n.toFixed(1)} hrs`;
}

const COPY = {
  en: {
    title: (c) => `Automation Proposal — ${c}`,
    preparedFor: 'Prepared for',
    preparedBy: 'Prepared by',
    date: 'Date',
    executiveSummary: 'Executive Summary',
    summaryBody: (p) =>
      `Based on the figures you provided, automating the manual work described below recovers an estimated ` +
      `${hours(p.savings.labour.hoursRecoveredMonthly)} per month and is projected to add ` +
      `${money(p.savings.revenue.annual, p.currency)} in incremental annual revenue. ` +
      `Total first-year value is ${money(p.savings.firstYearValue, p.currency)}.`,
    investment: 'Investment',
    buildFee: 'One-time setup fee',
    retainer: 'Monthly retainer',
    yearOne: 'Year-one total',
    whatYouGet: 'What the retainer covers',
    retainerItems: [
      'Monitoring and alerting on every workflow (you hear about failures before your clients do)',
      'Upstream API changes, credential rotation and version bumps',
      'Incident response and fixes',
      'One new small workflow per month',
      'Monthly report showing hours saved and response-time improvement',
    ],
    timeline: 'Timeline',
    timelineBody: 'First workflow live within 7–14 days of kickoff. Full delivery in 3–4 weeks.',
    assumptions: 'Assumptions & limits',
    assumptionsItems: [
      'All figures are based on the numbers you supplied during discovery. We have not independently audited them.',
      'Revenue figures are incremental only, and are already discounted for estimation error.',
      'A human approval step remains in every workflow that touches customer money or data.',
      'Savings are realised only if the manual process is actually retired, not merely supplemented.',
    ],
    nextStep: 'Next step',
    nextStepBody: 'Reply to this proposal to book kickoff. No obligation until then.',
    flagTitle: 'Notes on the assumptions',
  },
  ar: {
    title: (c) => `عرض أتمتة — ${c}`,
    preparedFor: 'مُعدّ لـ',
    preparedBy: 'مُعدّ بواسطة',
    date: 'التاريخ',
    executiveSummary: 'الملخص التنفيذي',
    summaryBody: (p) =>
      `بناءً على الأرقام التي قدّمتها، فإن أتمتة الأعمال اليدوية الموصوفة أدناه تسترجع ما يقارب ` +
      `${hours(p.savings.labour.hoursRecoveredMonthly)} شهريًا، ومن المتوقّع أن تضيف ` +
      `${money(p.savings.revenue.annual, p.currency)} في إيرادات سنوية إضافية. ` +
      `إجمالي القيمة خلال السنة الأولى هو ${money(p.savings.firstYearValue, p.currency)}.`,
    investment: 'الاستثمار',
    buildFee: 'رسوم الإعداد لمرة واحدة',
    retainer: 'الاشتراك الشهري',
    yearOne: 'إجمالي السنة الأولى',
    whatYouGet: 'ما يشمله الاشتراك الشهري',
    retainerItems: [
      'مراقبة وتنبيه على كل مسار عمل (تصل إشعار الأعطال قبل أن تصل إلى عملائك)',
      'تحديث واجهات البرمجة، تدوير بيانات الاعتماد، والترقيات الأمنية',
      'الاستجابة للأعطال وإصلاحها',
      'مسار عمل صغير جديد شهريًا',
      'تقرير شهري يوضح الساعات الموفّرة وتحسّن سرعة الاستجابة',
    ],
    timeline: 'الجدول الزمني',
    timelineBody: 'تشغيل أول مسار عمل خلال ٧–١٤ يومًا من البداية. التسليم الكامل خلال ٣–٤ أسابيع.',
    assumptions: 'الافتراضات والحدود',
    assumptionsItems: [
      'جميع الأرقام مبنية على القيم التي زوّدت بها أثناء جلسة الاستكشاف، ولم نتحقق منها بشكل مستقل.',
      'الإيرادات المذكورة هي الإيرادات الإضافية فقط، وقد خُفِّضت بالفعل meritlion بمعامل تقدير متحفّظ.',
      'يبقى هناكstep بشري approvals في كل مسار عمل يمسّ أموال العملاء أو بياناتهم.',
      'التحقق من الوقت الموفّر يتحقق فقط إذا أُوقف العمل اليدوي فعليًا، ولمجرد إضافة أداة جديدة إليه.',
    ],
    nextStep: 'الخطوة التالية',
    nextStepBody: 'ردّ على هذا العرض لتحديد موعد البداية. لا التزام قبل ذلك.',
    flagTitle: 'ملاحظات على الافتراضات',
  },
};

// Fix two deliberately-detected translation slips above so the doc is shippable.
COPY.ar.assumptionsItems[1] =
  'الإيرادات المذكورة هي الإيرادات الإضافية فقط، وقد خُفِّضت مسبقًا بمعامل تقدير متحفّفظ.';
COPY.ar.assumptionsItems[2] =
  'يبقى هناك خطوة موافقة بشرية في كل مسار عمل يمسّ أموال العملاء أو بياناتهم.';

function buildProposal({ client, currency, lang, inputs, options }) {
  const c = COPY[lang];
  const p = price({ inputs, options: { ...options, currency } });
  const rtl = lang === 'ar';

  const flagLines = p.flags.map((f) => {
    const mark = f.level === 'error' ? '⛔' : f.level === 'warn' ? '⚠️' : 'ℹ️';
    return `- ${mark} ${f.msg}`;
  });

  const body = `## ${c.executiveSummary}

${c.summaryBody(p)}

## ${c.investment}

| Item | Amount |
|---|---:|
| ${c.buildFee} | ${money(p.pricing.buildFee, currency)} |
| ${c.retainer} | ${money(p.pricing.monthlyRetainer, currency)}/mo |
| **${c.yearOne}** | **${money(p.pricing.yearOneTotal, currency)}** |

## ${c.whatYouGet}

${c.retainerItems.map((i) => `- ${i}`).join('\n')}

## ${c.timeline}

${c.timelineBody}

## ${c.assumptions}

${c.assumptionsItems.map((i) => `- ${i}`).join('\n')}

## ${c.flagTitle}

${flagLines.length ? flagLines.join('\n') : '- ✅ No issues found in the submitted figures.'}

## ${c.nextStep}

${c.nextStepBody}
`;

  const T = lang === 'ar'
    ? {
        summaryTitle: 'ملخص القيمة',
        colMetric: 'المؤشر',
        colValue: 'القيمة',
        hoursMonth: 'ساعات مسترجعة / شهريًا',
        hoursYear: 'ساعات مسترجعة / سنويًا',
        labourYear: 'قيمة وقت العمل / سنويًا',
        apptsMonth: 'مواعيد إضافية / شهريًا',
        dealsMonth: 'صفقات إضافية / شهريًا',
        revenueYear: 'الإيرادات / سنويًا',
        total: '**إجمالي قيمة السنة الأولى**',
      }
    : {
        summaryTitle: 'Value Summary',
        colMetric: 'Metric',
        colValue: 'Value',
        hoursMonth: 'Recovered hours / month',
        hoursYear: 'Recovered hours / year',
        labourYear: 'Labour value / year',
        apptsMonth: 'Incremental appointments / month',
        dealsMonth: 'Incremental deals / month',
        revenueYear: 'Revenue / year',
        total: '**Total first-year value**',
      };

  const valueRows = [
    [T.hoursMonth, hours(p.savings.labour.hoursRecoveredMonthly)],
    [T.hoursYear, hours(p.savings.labour.hoursRecoveredMonthly * 12)],
    [T.labourYear, money(p.savings.labour.annual, currency)],
    [T.apptsMonth, String(round2(p.savings.revenue.incrementalAppointmentsMonthly))],
    [T.dealsMonth, String(round2(p.savings.revenue.incrementalDealsMonthly))],
    [T.revenueYear, money(p.savings.revenue.annual, currency)],
    [T.total, `**${money(p.savings.firstYearValue, currency)}**`],
  ]
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join('\n');

  const md = `${rtl ? '<!-- dir="rtl" lang="ar" -->' : ''}
# ${c.title(client)}

**${c.preparedFor}:** ${client}
**${c.date}:** ${new Date().toISOString().slice(0, 10)}

---

## ${T.summaryTitle}

| ${T.colMetric} | ${T.colValue} |
|---|---:|
${valueRows}
`;

  return { markdown: md, priced: p };
}

function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

function mdToHtml(md, rtl) {
  const lines = md.split('\n');
  const out = [];
  let inTable = false;
  let listMode = null;

  const closeList = () => { if (listMode) { out.push(`</${listMode}>`); listMode = null; } };
  const closeTable = () => { if (inTable) { out.push('</tbody></table>'); inTable = false; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); closeTable(); continue; }
    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (!inTable) {
        closeList();
        out.push('<table><thead><tr>' + cells.map((c) => `<th>${htmlEscape(c)}</th>`).join('') + '</tr></thead><tbody>');
        inTable = true;
      } else {
        out.push('<tr>' + cells.map((c) => `<td>${htmlEscape(c).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</td>`).join('') + '</tr>');
      }
      continue;
    }
    closeTable();
    if (/^#{1,6}\s/.test(line)) {
      closeList();
      const lvl = line.match(/^#+/)[0].length;
      out.push(`<h${lvl}>${htmlEscape(line.replace(/^#+\s*/, ''))}</h${lvl}>`);
      continue;
    }
    if (/^[-*]\s/.test(line)) {
      if (listMode !== 'ul') { closeList(); out.push('<ul>'); listMode = 'ul'; }
      out.push(`<li>${htmlEscape(line.replace(/^[-*]\s*/, '')).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</li>`);
      continue;
    }
    if (/^---+$/.test(line)) { closeList(); out.push('<hr>'); continue; }
    closeList();
    out.push(`<p>${htmlEscape(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`);
  }
  closeList(); closeTable();
  return out.join('\n');
}

function renderHtml({ md, client, lang }) {
  const rtl = lang === 'ar';
  const title = `${client} — ${lang === 'ar' ? 'عرض الأتمتة' : 'Automation Proposal'}`;
  return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${htmlEscape(title)}</title>
<style>
  :root { --fg:#1a1a1a; --muted:#666; --line:#e3e3e3; --accent:${rtl ? '#0a7d3f' : '#0b5fff'}; }
  * { box-sizing:border-box; }
  body { font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Naskh Arabic",Tahoma,sans-serif;
         color:var(--fg); max-width:760px; margin:0 auto; padding:48px 24px; }
  h1 { font-size:1.9rem; margin:0 0 .4em; letter-spacing:-.02em; }
  h2 { font-size:1.25rem; margin:2.2em 0 .6em; padding-bottom:.3em; border-bottom:1px solid var(--line); }
  table { width:100%; border-collapse:collapse; margin:1.2em 0; font-size:.95rem; }
  th,td { padding:10px 12px; border-bottom:1px solid var(--line); }
  th { text-align:${rtl ? 'right' : 'left'}; font-weight:600; color:var(--muted); font-size:.82rem; text-transform:uppercase; letter-spacing:.04em; }
  td:not(:first-child) { text-align:${rtl ? 'left' : 'right'}; font-variant-numeric:tabular-nums; }
  tr:last-child td { border-bottom:2px solid var(--fg); font-weight:700; }
  ul { padding-inline-start:1.3em; } li { margin:.45em 0; }
  hr { border:0; border-top:1px solid var(--line); margin:2.5em 0; }
  @media print { body { padding:0; } h2 { break-after:avoid; } table { break-inside:avoid; } }
</style>
</head>
<body>
${mdToHtml(md, rtl)}
</body>
</html>`;
}

// --- CLI ---------------------------------------------------------------------
// Realistic mid-market Dubai agency, ~5 agents.
// 18 qualified leads/mo, 4-hour median response, AED 900k average deal,
// 20% appointment-to-close. 11% -> 19% contact lift is the published case.
const DEMO = {
  client: { en: 'Marina Bay Properties', ar: 'مارينا باي بروبرتيز' },
  currency: 'AED',
  inputs: {
    hoursPerWeek: 22,
    automationRate: 0.7,
    leadsPerMonth: 18,
    baselineContactRate: 0.11,
    improvedContactRate: 0.19,
    closeRate: 0.2,
    dealValue: 900000,
    confidence: 0.8,
  },
};

function main() {
  const argv = process.argv.slice(2);
  const arg = (name, def) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
  };
  const has = (name) => argv.includes(`--${name}`);

  const outDir = path.resolve(arg('out', 'out'));
  fs.mkdirSync(outDir, { recursive: true });

  const isDemo = has('demo');
  const spec = isDemo
    ? DEMO
    : JSON.parse(fs.readFileSync(path.resolve(arg('input', 'discovery.json')), 'utf8'));

  const client = typeof spec.client === 'object' ? spec.client.en : spec.client;
  const results = [];

  for (const lang of ['en', 'ar']) {
    const { markdown, priced } = buildProposal({
      client,
      currency: spec.currency || 'AED',
      lang,
      inputs: spec.inputs,
      options: spec.options || {},
    });
    const stem = `proposal-${client.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${lang}`;
    fs.writeFileSync(path.join(outDir, `${stem}.md`), markdown);
    fs.writeFileSync(path.join(outDir, `${stem}.html`), renderHtml({ md: markdown, client, lang }));
    results.push({ lang, file: stem, ...priced.pricing });
  }

  const p = price({ inputs: spec.inputs, options: { ...(spec.options || {}), currency: spec.currency || 'AED' } });
  console.log('─'.repeat(56));
  console.log(`Client:        ${client}  (${spec.currency || 'AED'})`);
  console.log(`First-year val: ${money(p.savings.firstYearValue, p.currency)}`);
  console.log(`Setup fee:      ${money(p.pricing.buildFee, p.currency)}`);
  console.log(`Monthly:        ${money(p.pricing.monthlyRetainer, p.currency)}/mo  (${p.pricing.marginPct}% margin)`);
  console.log(`Year one:       ${money(p.pricing.yearOneTotal, p.currency)}`);
  if (p.flags.length) {
    console.log('─'.repeat(56));
    for (const f of p.flags) console.log(`  ${f.level.toUpperCase()}: ${f.msg}`);
  }
  console.log('─'.repeat(56));
  for (const r of results) console.log(`wrote ${r.lang}: ${outDir}/${r.file}.{md,html}`);

  if (p.flags.some((f) => f.level === 'error')) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
