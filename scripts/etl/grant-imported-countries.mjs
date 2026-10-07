// Post-import step: country access.
//
// Access to a record is scoped by country. The seed data only ever covered
// EG / AE / SA, so after importing history from 24 countries every user would
// silently see a slice of the truth — Poland, India and Mexico would simply not
// exist for them, and no error would say why.
//
// This grants every imported country to the users who already hold the full
// seeded set (the head-office profile). Narrower, per-salesperson scopes are set
// from the admin screens; this only fixes the users who were already global.

import { connect } from "./lib/pipeline.mjs";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connect();
  try {
    const { rows: countries } = await db.query(
      `SELECT code FROM countries WHERE active`,
    );
    const { rows: users } = await db.query(
      `SELECT user_id, count(*)::int AS n
         FROM user_country_access
        WHERE status_code = 'ACTIVE'
        GROUP BY user_id
       HAVING count(*) >= 3`,
    );

    process.stdout.write(
      `  ${users.length} global user(s) x ${countries.length} countries\n`,
    );
    if (dryRun) {
      process.stdout.write("  --dry-run: nothing granted.\n");
      return;
    }

    let granted = 0;
    for (const user of users) {
      for (const country of countries) {
        const result = await db.query(
          `INSERT INTO user_country_access (user_id, country_code, granted_by, status_code)
           VALUES ($1,$2,$1,'ACTIVE')
           ON CONFLICT (user_id, country_code) DO NOTHING`,
          [user.user_id, country.code],
        );
        granted += result.rowCount ?? 0;
      }
    }
    process.stdout.write(`  ${granted} new grant(s).\n`);
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
});
