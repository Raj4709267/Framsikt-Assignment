import type Database from 'better-sqlite3';
import { openDatabase } from './connection.js';

export function seedDatabase(database: Database.Database): void {
  const seed = database.transaction(() => {
    const addOffice = database.prepare(`INSERT INTO offices (name, currency, monthly_budget)
      VALUES (@name, @currency, @budget)
      ON CONFLICT(name) DO UPDATE SET currency = excluded.currency, monthly_budget = excluded.monthly_budget,
      updated_at = datetime('now')`);
    addOffice.run({ name: 'Oslo', currency: 'NOK', budget: 600000 });
    addOffice.run({ name: 'Bengaluru', currency: 'INR', budget: 1500000 });

    const offices = database.prepare('SELECT id, name FROM offices ORDER BY id').all() as Array<{ id: number; name: string }>;
    const addCounter = database.prepare(`INSERT INTO snack_counters (office_id, name, location)
      VALUES (?, ?, ?) ON CONFLICT(office_id, name) DO NOTHING`);
    const addEmployee = database.prepare(`INSERT INTO employees (office_id, name, email)
      VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name, office_id = excluded.office_id,
      is_active = 1, updated_at = datetime('now')`);
    const employeeId = database.prepare('SELECT id FROM employees WHERE email = ?');
    const addAvailability = database.prepare(`INSERT INTO volunteer_availability
      (employee_id, office_id, is_volunteer, availability_status, available_from)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT DO NOTHING`);
    const addEligibility = database.prepare(`INSERT INTO volunteer_office_eligibility (employee_id, office_id, available_from)
      VALUES (?, ?, '1970-01-01') ON CONFLICT(employee_id, office_id, available_from) DO NOTHING`);

    for (const office of offices) {
      for (const suffix of ['Kitchen', 'Lounge']) addCounter.run(office.id, `${office.name} ${suffix}`, `${suffix} area`);
      for (let i = 1; i <= 5; i += 1) {
        const email = `snack.${office.name.toLowerCase()}.${i}@example.test`;
        addEmployee.run(office.id, `${office.name} Employee ${i}`, email);
        const row = employeeId.get(email) as { id: number };
        const volunteering = i <= 3;
        const status = i === 3 ? 'on_leave' : i === 4 ? 'unavailable' : 'available';
        addAvailability.run(row.id, office.id, volunteering ? 1 : 0, status);
        addEligibility.run(row.id, office.id);
      }
    }
  });
  seed();
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  const database = openDatabase();
  try {
    seedDatabase(database);
    console.info('Seed data inserted or already present.');
  } finally {
    database.close();
  }
}
