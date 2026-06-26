import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const email = process.argv[2];
const label = process.argv[3] ?? 'cli-device';
if (!email) {
  console.error('Usage: tsx scripts/seed-device.ts <email> [label]');
  process.exit(1);
}

const token = `cccloud_${randomBytes(32).toString('base64url')}`;
const tokenHash = createHash('sha256').update(token).digest('hex');
const userId = `usr_${randomBytes(12).toString('hex')}`;
const deviceId = `dev_${randomBytes(12).toString('hex')}`;
const now = Date.now();

// Dev-only seeding into the LOCAL D1. Values are generated here (no user input
// is interpolated beyond the email/label arguments you control).
const sql = `
INSERT INTO users (id, email, public_to_group, created_at) VALUES ('${userId}', '${email}', 0, ${now});
INSERT INTO devices (id, user_id, token_sha256, label, created_at) VALUES ('${deviceId}', '${userId}', '${tokenHash}', '${label}', ${now});
`;

execFileSync('wrangler', ['d1', 'execute', 'ccusage-cloud', '--local', '--command', sql], {
  stdio: 'inherit',
});

console.log(`\nDevice enrolled for ${email}.`);
console.log(`Device token (shown once — store securely):\n\n  ${token}\n`);
