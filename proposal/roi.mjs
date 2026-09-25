/**
 * Value-based pricing engine.
 *
 * Clients don't buy hours, they buy recovered time and won revenue. This module
 * turns a discovery call's numbers into a defensible price using the 10-20% of
 * first-year value band that closes deals in this market.
 *
 * Every input is a client-supplied figure. We never invent their numbers, so
 * the proposal survives contact with a sceptical CFO.
 */

export const CURRENCIES = {
  AED: { symbol: 'AED', locale: 'en-AE', dir: 'ltr' },
  SAR: { symbol: 'SAR', locale: 'en-SA', dir: 'rtl' },
  USD: { symbol: 'USD', locale: 'en-US', dir: 'ltr' },
  EGP: { symbol: 'EGP', locale: 'ar-EG', dir: 'rtl' },
};

/** Fully-loaded monthly cost of one staff hour, in local currency. */
export const DEFAULT_HOURLY_COST = {
  AED: 45,
  SAR: 45,
  USD: 28,
  EGP: 120,
};

/** Plausibility ceilings. A quote above these is a comedy, not a proposal. */
export const PLAUSIBILITY = {
  maxAnnualValue: 5_000_000,
  maxMonthlyRetainer: 50_000,
  maxDealsPerMonth: 20,
  maxDealValue: 1_000_000,
};

function assertPositive(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number, got: ${value}`);
  }
  return value;
}

function assertPositiveInt(value, name) {
  const n = assertPositive(value, name);
  if (!Number.isInteger(n)) {
    throw new RangeError(`${name} must be a whole number, got: ${value}`);
  }
  return n;
}

/**
 * Labour recovered by automating a task.
 * Only counts hours that genuinely go away; a fraction of the workflow still
 * needs a human, so `automationRate` is the share we can honestly claim.
 */
export function labourSavings({ hoursPerWeek, automationRate, hourlyCost }) {
  assertPositive(hoursPerWeek, 'hoursPerWeek');
  assertPositive(automationRate, 'automationRate');
  assertPositive(hourlyCost, 'hourlyCost');

  if (automationRate > 1) {
    throw new RangeError(`automationRate is a fraction 0-1, got: ${automationRate}`);
  }

  const hoursRecoveredMonthly = (hoursPerWeek * automationRate * 52) / 12;
  return {
    hoursRecoveredMonthly,
    monthly: hoursRecoveredMonthly * hourlyCost,
    annual: hoursRecoveredMonthly * hourlyCost * 12,
  };
}

/**
 * Revenue recovered by responding faster.
 *
 * The honest chain is: faster response -> more appointments -> some of those
 * close. Collapsing it to "incremental deals = leads x contact-rate lift" is
 * what turns a 40-lead agency into a fantasy pipeline, because a contacted lead
 * is not a closed deal.
 *
 *   incremental appointments = leads x (new contact rate - old contact rate)
 *   incremental deals        = incremental appointments x closeRate
 *   revenue                  = incremental deals x dealValue x confidence
 *
 * `closeRate` is the client's own historical figure. When they don't know it,
 * pass a conservative default rather than omitting it.
 */
export function revenueImpact({
  leadsPerMonth,
  baselineContactRate,
  improvedContactRate,
  closeRate,
  dealValue,
  confidence = 0.8,
}) {
  assertPositiveInt(leadsPerMonth, 'leadsPerMonth');
  assertPositive(baselineContactRate, 'baselineContactRate');
  assertPositive(improvedContactRate, 'improvedContactRate');
  assertPositive(closeRate, 'closeRate');
  assertPositive(dealValue, 'dealValue');
  assertPositive(confidence, 'confidence');

  for (const [name, rate] of [
    ['baselineContactRate', baselineContactRate],
    ['improvedContactRate', improvedContactRate],
    ['closeRate', closeRate],
  ]) {
    if (rate > 1) throw new RangeError(`${name} is a fraction 0-1, got: ${rate}`);
  }

  const incrementalAppointmentsMonthly =
    leadsPerMonth * (improvedContactRate - baselineContactRate);
  const incrementalDealsMonthly = incrementalAppointmentsMonthly * closeRate;
  const grossMonthly = incrementalDealsMonthly * dealValue;

  return {
    incrementalAppointmentsMonthly,
    incrementalDealsMonthly,
    grossMonthly,
    monthly: grossMonthly * confidence,
    annual: grossMonthly * confidence * 12,
  };
}

/** One-time setup cost, amortised and shown honestly against the retainer. */
export function setupEconomics({ setupFee, monthsToPaybackTarget = 3 }) {
  assertPositive(setupFee, 'setupFee');
  assertPositive(monthsToPaybackTarget, 'monthsToPaybackTarget');
  return {
    setupFee,
    monthsToPaybackTarget,
    note:
      'Setup is one-time. The retainer is what recurs and covers monitoring, ' +
      'credential rotation, upstream API changes and new workflows.',
  };
}

/**
 * Full pricing model.
 *
 * Defaults: build fee = 10% of first-year value, which is the conservative end
 * of the 10-20% band and matches the published case study (AED/USD 95k of value
 * -> $8.5k build). Retainer = 15% of the build fee per month.
 *
 * We quote the low end deliberately: a client who feels the first number was
 * inflated discounts the retainer too, and a proposal that prices at 20% gets
 * read as a negotiation opener.
 *
 * Both are floored so a tiny business still clears the cost of actually
 * showing up, and capped so we never quote a number we can't deliver.
 */
export function price({ inputs, options = {} }) {
  const {
    hoursPerWeek,
    automationRate = 0.7,
    leadsPerMonth = 0,
    baselineContactRate = 0,
    improvedContactRate = 0,
    closeRate = 0.2,
    dealValue = 0,
    confidence = 0.8,
  } = inputs;

  const currency = options.currency || 'AED';
  if (!CURRENCIES[currency]) {
    throw new RangeError(`Unknown currency: ${currency}. Expected one of ${Object.keys(CURRENCIES).join(', ')}`);
  }
  const hourlyCost = options.hourlyCost ?? DEFAULT_HOURLY_COST[currency];
  const buildRate = options.buildRate ?? 0.10;
  const retainerRate = options.retainerRate ?? 0.15;

  const labour = labourSavings({ hoursPerWeek, automationRate, hourlyCost });

  const revenue =
    leadsPerMonth > 0
      ? revenueImpact({
          leadsPerMonth,
          baselineContactRate,
          improvedContactRate,
          closeRate,
          dealValue,
          confidence,
        })
      : { incrementalAppointmentsMonthly: 0, incrementalDealsMonthly: 0, grossMonthly: 0, monthly: 0, annual: 0 };

  const firstYearValue = labour.annual + revenue.annual;

  let buildFee = firstYearValue * buildRate;
  let retainer = buildFee * retainerRate;

  // Floors. Below these, the engagement does not pay for itself in attention.
  const floors =
    currency === 'EGP'
      ? { build: 3000, retainer: 900 }
      : { build: 1500, retainer: 300 };

  if (firstYearValue > 0) {
    buildFee = Math.max(buildFee, floors.build);
    retainer = Math.max(buildFee * retainerRate, floors.retainer);
  } else {
    buildFee = 0;
    retainer = 0;
  }

  const monthlyRunningCost = options.monthlyInfraCost ?? 15;
  const grossMarginMonthly = retainer - monthlyRunningCost;

  // Round to a number a human would say out loud.
  const round = (n) => (n >= 1000 ? Math.round(n / 100) * 100 : Math.round(n / 50) * 50);

  const buildFeeRounded = round(buildFee);
  const retainerRounded = round(retainer);

  return {
    currency,
    inputs: { ...inputs, hourlyCost, automationRate, confidence },
    savings: {
      labour: labour,
      revenue: revenue,
      firstYearValue: round(firstYearValue),
      firstYearValueExact: firstYearValue,
    },
    pricing: {
      buildFee: buildFeeRounded,
      monthlyRetainer: retainerRounded,
      yearOneTotal: buildFeeRounded + retainerRounded * 12,
      monthlyGrossMargin: round(grossMarginMonthly),
      marginPct: retainerRounded > 0 ? Math.round((grossMarginMonthly / retainerRounded) * 100) : 0,
    },
    payback: {
      months: retainerRounded > 0 ? Math.ceil(buildFeeRounded / (firstYearValue / 12 || 1)) : 0,
      coveredByYearOne: firstYearValue >= buildFeeRounded,
    },
    flags: buildFlags({ inputs, firstYearValue, retainer, revenue }),
  };
}

/** Honest red flags surfaced in the proposal rather than hidden in a footnote. */
function buildFlags({ inputs, firstYearValue, retainer, revenue }) {
  const flags = [];

  if (firstYearValue <= 0) {
    flags.push({
      level: 'error',
      msg: 'No measurable value found. Do not send a proposal — run discovery again.',
    });
    return flags;
  }

  if (retainer > PLAUSIBILITY.maxMonthlyRetainer) {
    flags.push({
      level: 'error',
      msg:
        `Retainer of ${Math.round(retainer).toLocaleString('en-US')}/mo is above the ` +
        `${PLAUSIBILITY.maxMonthlyRetainer.toLocaleString('en-US')} solo-operator ceiling. ` +
        'Split it into multiple engagements or re-scope the value.',
    });
  }

  if ((inputs.automationRate ?? 0.7) > 0.9) {
    flags.push({
      level: 'warn',
      msg: 'Automation rate above 90% is not credible. Clients always keep a human approval step.',
    });
  }

  if (inputs.baselineContactRate !== undefined && inputs.improvedContactRate > inputs.baselineContactRate * 3) {
    flags.push({
      level: 'warn',
      msg: 'Implied contact-rate lift is over 3x. Sceptical buyers will reject this — show the source data.',
    });
  }

  if (inputs.hoursPerWeek > 40) {
    flags.push({
      level: 'warn',
      msg: 'More than 40 hrs/week automated suggests the task is larger than one workflow. Scope it as a project.',
    });
  }

  if (firstYearValue > PLAUSIBILITY.maxAnnualValue) {
    flags.push({
      level: 'error',
      msg:
        `First-year value of ${Math.round(firstYearValue).toLocaleString('en-US')} is above the ` +
        `${PLAUSIBILITY.maxAnnualValue.toLocaleString('en-US')} plausibility ceiling. Re-check the deal ` +
        'count and deal value — an inflated quote loses the deal on the first call.',
    });
  }

  if (revenue.incrementalDealsMonthly > PLAUSIBILITY.maxDealsPerMonth) {
    flags.push({
      level: 'error',
      msg:
        `${Math.round(revenue.incrementalDealsMonthly)} incremental deals/month exceeds what a mid-market ` +
        'agency sustains. Recalculate leads vs. contact-rate lift.',
    });
  }

  if (inputs.dealValue > PLAUSIBILITY.maxDealValue) {
    flags.push({
      level: 'warn',
      msg: 'Deal value above 1M skews the whole model. Confirm it is typical, not the top listing.',
    });
  }

  if (firstYearValue > 0 && firstYearValue < 5000) {
    flags.push({
      level: 'info',
      msg: 'Low total value. Lead with speed and reliability, not ROI. Price on the retainer floor.',
    });
  }

  return flags;
}
