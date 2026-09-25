import test from 'node:test';
import assert from 'node:assert/strict';
import {
  price,
  labourSavings,
  revenueImpact,
  DEFAULT_HOURLY_COST,
} from '../proposal/roi.mjs';

test('labour savings: 5 hrs/wk at 70% automation recovers ~15 hrs/month', () => {
  const r = labourSavings({ hoursPerWeek: 5, automationRate: 0.7, hourlyCost: 50 });
  // 5 * 0.7 * 52 / 12 = 15.1667 hrs/month
  assert.ok(Math.abs(r.hoursRecoveredMonthly - 15.1667) < 0.01);
  assert.ok(Math.abs(r.monthly - 758.33) < 0.01);
  assert.ok(Math.abs(r.annual - r.monthly * 12) < 0.01);
});

test('revenue impact only counts the incremental lift, never total revenue', () => {
  const r = revenueImpact({
    leadsPerMonth: 100,
    baselineContactRate: 0.1,
    improvedContactRate: 0.2,
    closeRate: 1,
    dealValue: 100000,
    confidence: 1,
  });
  // closeRate 1 isolates the lift itself: 100 * 0.1 = 10
  assert.equal(r.incrementalDealsMonthly, 10);
  assert.equal(r.grossMonthly, 1_000_000);
});

test('confidence factor reduces claimed value', () => {
  const full = revenueImpact({
    leadsPerMonth: 50, baselineContactRate: 0.1,
    improvedContactRate: 0.3, closeRate: 0.3, dealValue: 10000, confidence: 1,
  });
  const hedged = revenueImpact({
    leadsPerMonth: 50, baselineContactRate: 0.1,
    improvedContactRate: 0.3, closeRate: 0.3, dealValue: 10000, confidence: 0.8,
  });
  assert.equal(hedged.monthly, full.monthly * 0.8);
});

test('rejects automationRate above 1', () => {
  assert.throws(
    () => labourSavings({ hoursPerWeek: 5, automationRate: 1.5, hourlyCost: 50 }),
    RangeError
  );
});

test('rejects negative and non-numeric inputs', () => {
  assert.throws(() => labourSavings({ hoursPerWeek: -1, automationRate: 0.5, hourlyCost: 50 }), RangeError);
  assert.throws(() => labourSavings({ hoursPerWeek: 5, automationRate: 0.5, hourlyCost: 'x' }), RangeError);
  assert.throws(() => labourSavings({ hoursPerWeek: NaN, automationRate: 0.5, hourlyCost: 50 }), RangeError);
});

test('revenue impact chains contact -> appointment -> close, never contact -> deal', () => {
  const r = revenueImpact({
    leadsPerMonth: 100,
    baselineContactRate: 0.1,
    improvedContactRate: 0.2,
    closeRate: 0.25,
    dealValue: 100000,
    confidence: 1,
  });
  // 100 leads x 0.1 lift = 10 incremental appointments
  assert.equal(r.incrementalAppointmentsMonthly, 10);
  // only 25% of those close = 2.5 deals, not 10
  assert.equal(r.incrementalDealsMonthly, 2.5);
  assert.equal(r.grossMonthly, 250000);
});

test('omitting closeRate does not inflate revenue to deal-per-lead', () => {
  const withClose = revenueImpact({
    leadsPerMonth: 100, baselineContactRate: 0.1, improvedContactRate: 0.2,
    closeRate: 0.2, dealValue: 100000, confidence: 1,
  });
  assert.ok(withClose.incrementalDealsMonthly < 10, 'must not treat every contacted lead as a sale');
});

test('rejects a closeRate above 1', () => {
  assert.throws(
    () => revenueImpact({
      leadsPerMonth: 10, baselineContactRate: 0.1, improvedContactRate: 0.2,
      closeRate: 1.5, dealValue: 1000,
    }),
    RangeError
  );
});

test('rejects fractional lead counts', () => {
  assert.throws(
    () => revenueImpact({
      leadsPerMonth: 10.5, baselineContactRate: 0.1,
      improvedContactRate: 0.2, dealValue: 1000,
    }),
    RangeError
  );
});

test('rejects unknown currency', () => {
  assert.throws(
    () => price({ inputs: { hoursPerWeek: 5 }, options: { currency: 'XYZ' } }),
    RangeError
  );
});

test('zero value produces zero price and an error flag, not a bogus quote', () => {
  const p = price({ inputs: { hoursPerWeek: 0 } });
  assert.equal(p.pricing.buildFee, 0);
  assert.equal(p.pricing.monthlyRetainer, 0);
  assert.equal(p.flags[0].level, 'error');
});

test('flags implausible automation rate', () => {
  const p = price({ inputs: { hoursPerWeek: 4, automationRate: 0.95 } });
  assert.ok(p.flags.some((f) => f.msg.includes('90%')));
});

test('flags an over-3x contact rate lift as a credibility risk', () => {
  const p = price({
    inputs: {
      hoursPerWeek: 4, leadsPerMonth: 100,
      baselineContactRate: 0.05, improvedContactRate: 0.5, dealValue: 50000,
    },
  });
  assert.ok(p.flags.some((f) => f.msg.includes('3x')));
});

test('retainer floor applies to small businesses', () => {
  const p = price({ inputs: { hoursPerWeek: 0.5 }, options: { currency: 'AED' } });
  assert.ok(p.pricing.monthlyRetainer >= 300, 'retainer should not fall below floor');
});

test('retainer is ~17% of build fee for a mid-size account', () => {
  const p = price({
    inputs: { hoursPerWeek: 10, leadsPerMonth: 200, baselineContactRate: 0.1, improvedContactRate: 0.22, dealValue: 80000 },
    options: { currency: 'AED' },
  });
  const ratio = p.pricing.monthlyRetainer / p.pricing.buildFee;
  assert.ok(ratio > 0.12 && ratio < 0.25, `ratio was ${ratio}`);
});

test('year-one total = build + 12 months of retainer', () => {
  const p = price({ inputs: { hoursPerWeek: 6 } });
  assert.equal(p.pricing.yearOneTotal, p.pricing.buildFee + p.pricing.monthlyRetainer * 12);
});

test('labour-only quote has no revenue impact', () => {
  const p = price({ inputs: { hoursPerWeek: 8 } });
  assert.equal(p.savings.revenue.incrementalDealsMonthly, 0);
  assert.ok(p.savings.firstYearValue > 0);
});

test('EGP uses a different currency floor than AED', () => {
  const inputs = { hoursPerWeek: 0.5 };
  const egp = price({ inputs, options: { currency: 'EGP' } });
  const aed = price({ inputs, options: { currency: 'AED' } });
  assert.ok(egp.pricing.buildFee > aed.pricing.buildFee);
});

test('default hourly cost exists for every supported currency', () => {
  for (const c of Object.keys(DEFAULT_HOURLY_COST)) {
    const p = price({ inputs: { hoursPerWeek: 3 }, options: { currency: c } });
    assert.equal(p.currency, c);
  }
});

test('gross margin is positive after infra cost on any real retainer', () => {
  const p = price({ inputs: { hoursPerWeek: 8, automationRate: 0.8 } });
  assert.ok(p.pricing.monthlyGrossMargin > 0);
  assert.ok(p.pricing.marginPct > 50);
});
