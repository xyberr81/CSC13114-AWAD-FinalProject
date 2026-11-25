// Migrate a fresh verify database and seed the baseline fixtures. Run by up.sh; prints seed.json.
// Needs DATABASE_URL and JWT_SECRET. Tokens are signed exactly as the API's issueToken does.
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { SignJWT } from 'jose';
import pg from 'pg';

const { DATABASE_URL, JWT_SECRET } = process.env;
if (!DATABASE_URL || !JWT_SECRET) throw new Error('prepare-db needs DATABASE_URL and JWT_SECRET');

const HOUR = 60 * 60 * 1000;
const key = new TextEncoder().encode(JWT_SECRET);

function token(userId, expiresAt = new Date(Date.now() + 8 * HOUR)) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(key);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
  await migrate(drizzle(pool), {
    migrationsFolder: new URL('../../../../apps/api/drizzle', import.meta.url).pathname,
  });

  const one = async (sql, params) => (await pool.query(sql, params)).rows[0].id;
  const user = (email, role) =>
    one(`insert into users (email, password_hash, role) values ($1, 'x', $2) returning id`, [
      email,
      role,
    ]);
  const klass = (code, name) =>
    one(`insert into classes (code, name) values ($1, $2) returning id`, [code, name]);
  const lab = (classId, title, deadline) =>
    one(
      `insert into labs (class_id, title, statement, deadline) values ($1, $2, $3, $4) returning id`,
      [classId, title, `Implement ${title.toLowerCase()}.`, deadline],
    );
  const enrol = (classId, userId, role) =>
    pool.query(`insert into class_members (class_id, user_id, role) values ($1, $2, $3)`, [
      classId,
      userId,
      role,
    ]);

  const admin = await user('admin@verify.local', 'admin');
  const ta = await user('ta@verify.local', 'ta');
  const student = await user('student@verify.local', 'student');
  const outsider = await user('outsider@verify.local', 'student');

  const classA = await klass('CSC-A', 'Verify class A');
  const classB = await klass('CSC-B', 'Verify class B');
  await enrol(classA, ta, 'ta');
  await enrol(classA, student, 'student');
  await enrol(classB, outsider, 'student');

  const openLab = await lab(classA, 'Merge sort', new Date(Date.now() + 7 * 24 * HOUR));
  const closedLab = await lab(classA, 'Bubble sort', new Date(Date.now() - HOUR));
  const otherClassLab = await lab(classB, 'Quick sort', new Date(Date.now() + 7 * 24 * HOUR));

  const seed = {
    users: { admin, ta, student, outsider },
    classes: { classA, classB },
    labs: { openLab, closedLab, otherClassLab },
    tokens: {
      admin: await token(admin),
      ta: await token(ta),
      student: await token(student),
      outsider: await token(outsider),
      expiredStudent: await token(student, new Date(Date.now() - HOUR)),
    },
  };
  process.stdout.write(JSON.stringify(seed, null, 2) + '\n');
} finally {
  await pool.end();
}
