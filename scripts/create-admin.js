// Creates the first admin account (or resets an admin's password).
//
//   npm run create-admin
//
// The password is typed in the terminal (hidden), hashed with bcrypt and only
// the hash is saved in MySQL. Nothing is stored in a file and no default
// password exists.

require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('../server/database');

const BCRYPT_COST = 12;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,50}$/;
const MIN_PASSWORD_LENGTH = 12;

// Normal question (text is shown while typing).
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

// Password question: characters are masked with dots while typing.
function askHidden(question) {
  if (!process.stdin.isTTY) return ask(question); // e.g. input piped in: fall back to a normal prompt
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let value = '';
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') process.exit(130); // Ctrl+C
        if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (!/[\u0000-\u001f]/.test(ch)) {
          value += ch;
          process.stdout.write('•');
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  console.log('\nThe Sifted Cafe - create or reset an admin account\n');

  const username = (await ask('Username (3-50 letters, numbers, . _ -): ')).trim();
  if (!USERNAME_RE.test(username)) {
    throw new Error('Invalid username. Use 3-50 characters: letters, numbers, dot, underscore or hyphen.');
  }

  const existing = await db.query('SELECT id FROM admins WHERE username = ? LIMIT 1', [username]);
  if (existing.length > 0) {
    const answer = (await ask(`"${username}" already exists. Reset its password? (y/N): `)).trim().toLowerCase();
    if (answer !== 'y') {
      console.log('Nothing changed.');
      return;
    }
  }

  const password = await askHidden(`Password (at least ${MIN_PASSWORD_LENGTH} characters): `);
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (password.toLowerCase().includes(username.toLowerCase())) throw new Error('Password must not contain the username.');
  const confirm = await askHidden('Type the password again: ');
  if (confirm !== password) throw new Error('The two passwords do not match.');

  const hash = await bcrypt.hash(password, BCRYPT_COST);

  if (existing.length > 0) {
    await db.execute('UPDATE admins SET password_hash = ? WHERE id = ?', [hash, existing[0].id]);
    await db.execute('DELETE FROM admin_sessions WHERE admin_id = ?', [existing[0].id]); // sign out everywhere
    console.log(`\nPassword reset for "${username}". Existing sessions were signed out.`);
  } else {
    await db.execute('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [username, hash]);
    console.log(`\nAdmin "${username}" created. You can now sign in at http://localhost:${process.env.PORT || 3000}/admin`);
  }
}

main()
  .catch((err) => {
    if (err && err.code) {
      console.error(`\nDatabase error: ${db.describeDbError(err).hint}`);
    } else {
      console.error(`\nError: ${err.message}`);
    }
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
