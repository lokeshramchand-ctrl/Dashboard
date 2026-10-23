// Usage: npm run create-user -- <username>     (prompts for a password; or set NEW_PASSWORD)
// Creates the user, or resets the password if it already exists. Users live in MongoDB (collection: users).
import { createInterface } from 'node:readline';
import { hashPassword } from './auth.js';
import { closeDb, col, connectDb } from './db.js';

const username = (process.argv[2] ?? '').trim().toLowerCase();
if (!username) { console.error('Usage: npm run create-user -- <username>'); process.exit(1); }

function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const w = (rl as unknown as { _writeToOutput: (s: string) => void });
  const orig = w._writeToOutput.bind(rl);
  w._writeToOutput = (s) => { if (s.includes(prompt)) orig(s); }; // hide typed characters
  return new Promise((res) => rl.question(prompt, (a) => { rl.close(); process.stdout.write('\n'); res(a); }));
}

const password = process.env.NEW_PASSWORD ?? (await ask('Password: '));
if (password.length < 12) { console.error('Password must be at least 12 characters.'); process.exit(1); }
if (!process.env.NEW_PASSWORD && (await ask('Repeat password: ')) !== password) { console.error('Passwords do not match.'); process.exit(1); }

await connectDb();
const passwordHash = hashPassword(password);
const r = await col.users().updateOne(
  { username },
  { $set: { passwordHash }, $setOnInsert: { username, createdAt: new Date() } },
  { upsert: true },
);
if (!r.upsertedId) await col.sessions().deleteMany({ username }); // password reset logs the user out everywhere
console.log(r.upsertedId ? `Created user "${username}".` : `Updated password for "${username}" and ended its sessions.`);
await closeDb();
