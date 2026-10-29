const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/prisma');

const WORDS_ADJ = ['sunlit', 'amber', 'ivory', 'coral', 'olive', 'slate', 'pearl', 'sienna'];

// Human-friendly, globally-unique login id derived from the customer name plus a
// short random suffix. Studio shares this with the customer.
const generateLoginId = async (name) => {
  const base = (name || 'client')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'client';
  for (let i = 0; i < 12; i++) {
    const suffix = crypto.randomBytes(2).toString('hex');
    const loginId = `${base}-${suffix}`;
    const exists = await prisma.customer.findUnique({ where: { loginId } });
    if (!exists) return loginId;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
};

// Readable but strong temporary password (e.g. "amber-4821-slate").
const generatePassword = () => {
  const a = WORDS_ADJ[crypto.randomInt(WORDS_ADJ.length)];
  const b = WORDS_ADJ[crypto.randomInt(WORDS_ADJ.length)];
  const n = 1000 + crypto.randomInt(9000);
  return `${a}-${n}-${b}`;
};

const hashPassword = (plain) => bcrypt.hash(plain, 12);

module.exports = { generateLoginId, generatePassword, hashPassword };
