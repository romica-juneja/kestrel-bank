import bcrypt from 'bcryptjs';
import type { Db } from './connection.js';

/** Password shared by all demo users. Fictional data only. */
export const DEMO_PASSWORD = 'Demo#2026';
export const CLEARING_ACCOUNT_ID = 'acc_bank_clearing';

interface DemoCustomer {
  id: string;
  username: string;
  displayName: string;
  seed: number;
  checking: { id: string; number: string; opening: number };
  savings: { id: string; number: string; opening: number };
  payees: { id: string; name: string; bank: string; number: string }[];
}

const CUSTOMERS: DemoCustomer[] = [
  {
    id: 'cus_alex',
    username: 'alex',
    displayName: 'Alex Morgan',
    seed: 42,
    checking: { id: 'acc_alex_chk', number: '4410 2201 7781', opening: 2_400_00 },
    savings: { id: 'acc_alex_sav', number: '4410 2201 9034', opening: 8_250_00 },
    payees: [
      { id: 'pay_alex_landlord', name: 'Northside Property Management', bank: 'Harbor Trust', number: '7302 1184 0021' },
      { id: 'pay_alex_power', name: 'City Power & Light', bank: 'First Civic Bank', number: '5519 0042 3310' },
      { id: 'pay_alex_jordan', name: 'Jordan Lee', bank: 'Maple Credit Union', number: '2280 6617 4402' },
    ],
  },
  {
    id: 'cus_sam',
    username: 'sam',
    displayName: 'Sam Rivera',
    seed: 7,
    checking: { id: 'acc_sam_chk', number: '4410 3307 1265', opening: 1_150_00 },
    savings: { id: 'acc_sam_sav', number: '4410 3307 5820', opening: 3_900_00 },
    payees: [
      { id: 'pay_sam_gym', name: 'Ironworks Fitness', bank: 'Harbor Trust', number: '7302 5530 1179' },
      { id: 'pay_sam_priya', name: 'Priya Shah', bank: 'First Civic Bank', number: '5519 7781 0063' },
    ],
  },
];

/** Small deterministic PRNG so the demo data is the same on every start. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SeedEvent {
  at: Date;
  description: string;
  category: string;
  direction: 'debit' | 'credit';
  cents: number;
}

const DAY = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 180;

function checkingHistory(rand: () => number, now: Date): SeedEvent[] {
  const pick = <T,>(items: T[]): T => items[Math.floor(rand() * items.length)] as T;
  const between = (min: number, max: number) => Math.round(min + rand() * (max - min));
  const events: SeedEvent[] = [];

  for (let d = HISTORY_DAYS; d >= 1; d--) {
    const day = new Date(now.getTime() - d * DAY);
    const at = (hour: number) => {
      const t = new Date(day);
      t.setUTCHours(hour, between(0, 59), between(0, 59), 0);
      return t;
    };
    const dom = day.getUTCDate();

    if (dom === 1 || dom === 15) {
      events.push({ at: at(6), description: 'Payroll deposit - Brightline Logistics', category: 'income', direction: 'credit', cents: 1_780_00 });
    }
    if (dom === 1) {
      events.push({ at: at(9), description: 'Rent - Northside Property Mgmt', category: 'housing', direction: 'debit', cents: 1_450_00 });
    }
    if (dom === 5) {
      events.push({ at: at(11), description: 'City Power & Light', category: 'utilities', direction: 'debit', cents: between(70_00, 140_00) });
    }
    if (dom === 12) {
      events.push({ at: at(3), description: 'Streamly subscription', category: 'entertainment', direction: 'debit', cents: 15_99 });
    }
    if (dom === 20) {
      events.push({ at: at(10), description: 'Metro Mobile', category: 'utilities', direction: 'debit', cents: 45_00 });
    }
    if (rand() < 0.3) {
      events.push({ at: at(between(9, 20)), description: pick(['FreshMart', 'Green Basket Grocers', 'Corner Market', 'Costwise Wholesale']), category: 'groceries', direction: 'debit', cents: between(18_00, 145_00) });
    }
    if (rand() < 0.22) {
      events.push({ at: at(between(11, 22)), description: pick(['Luna Cafe', 'Tandoor House', 'Pizza Republic', 'Daily Grind Coffee']), category: 'dining', direction: 'debit', cents: between(6_00, 68_00) });
    }
    if (rand() < 0.12) {
      events.push({ at: at(between(7, 19)), description: pick(['Metro Transit card top-up', 'QuickRide', 'Shell fuel']), category: 'transport', direction: 'debit', cents: between(12_00, 60_00) });
    }
    if (rand() < 0.05) {
      events.push({ at: at(between(10, 18)), description: pick(['Pagewise Books', 'Northgate Pharmacy', 'HomeBase Hardware']), category: 'shopping', direction: 'debit', cents: between(15_00, 120_00) });
    }
  }
  return events;
}

function savingsHistory(now: Date, rand: () => number): SeedEvent[] {
  const events: SeedEvent[] = [];
  for (let d = HISTORY_DAYS; d >= 1; d--) {
    const day = new Date(now.getTime() - d * DAY);
    if (day.getUTCDate() === 28) {
      day.setUTCHours(4, 0, 0, 0);
      events.push({ at: day, description: 'Interest paid', category: 'interest', direction: 'credit', cents: Math.round(8_00 + rand() * 6_00) });
    }
  }
  return events;
}

/**
 * Seeded history for external counterparties (employer, shops) is single-sided by nature:
 * the other side lives at another bank. Every transfer made in the app is double-entry.
 */
function postHistory(db: Db, accountId: string, openingCents: number, now: Date, events: SeedEvent[]) {
  const insert = db.prepare(
    `INSERT INTO transactions (account_id, posted_at, description, category, direction, amount_cents, balance_after_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const openedAt = new Date(now.getTime() - (HISTORY_DAYS + 1) * DAY);
  let balance = openingCents;
  insert.run(accountId, openedAt.toISOString(), 'Opening balance', 'transfer', 'credit', openingCents, balance);

  for (const e of events.sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (e.direction === 'debit' && e.cents > balance) continue; // never seed an overdraft
    balance += e.direction === 'credit' ? e.cents : -e.cents;
    insert.run(accountId, e.at.toISOString(), e.description, e.category, e.direction, e.cents, balance);
  }
  db.prepare('UPDATE accounts SET balance_cents = ? WHERE id = ?').run(balance, accountId);
}

export function seed(db: Db, now: Date): void {
  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO accounts (id, customer_id, type, name, account_number, balance_cents)
       VALUES (?, NULL, 'clearing', 'Outgoing payments clearing', '0000 0000 0001', 0)`,
    ).run(CLEARING_ACCOUNT_ID);

    const insertAccount = db.prepare(
      `INSERT INTO accounts (id, customer_id, type, name, account_number, balance_cents) VALUES (?, ?, ?, ?, ?, 0)`,
    );
    const insertPayee = db.prepare(
      'INSERT INTO payees (id, customer_id, name, bank_name, account_number) VALUES (?, ?, ?, ?, ?)',
    );

    for (const c of CUSTOMERS) {
      const rand = mulberry32(c.seed);
      db.prepare('INSERT INTO customers (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)').run(
        c.id, c.username, c.displayName, passwordHash,
      );
      insertAccount.run(c.checking.id, c.id, 'checking', 'Everyday Checking', c.checking.number);
      insertAccount.run(c.savings.id, c.id, 'savings', 'Rainy Day Savings', c.savings.number);
      for (const p of c.payees) insertPayee.run(p.id, c.id, p.name, p.bank, p.number);

      postHistory(db, c.checking.id, c.checking.opening, now, checkingHistory(rand, now));
      postHistory(db, c.savings.id, c.savings.opening, now, savingsHistory(now, rand));
    }
  });
  run();
}
