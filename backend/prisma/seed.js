const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const randomPassword = () => crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) + 'A1!';

async function main() {
  const existing = await prisma.studio.findFirst();
  if (existing) {
    console.log('Studio already seeded:', existing.id);
    return;
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@sjclicks.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || randomPassword();
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const studio = await prisma.studio.create({
    data: {
      name: 'SJ Clicks',
      email: adminEmail,
      phone: '+91 90000 00000',
      admins: { create: { email: adminEmail, passwordHash, name: 'Studio Owner', role: 'OWNER' } },
      pricing: { create: { currency: 'INR', includedPhotos: 20, pricePerExtraPhoto: 200, baseGalleryFee: 0, watermarkEnabled: true } },
      clientTypes: {
        create: [
          {
            name: 'Wedding Basic',
            slug: 'wedding-basic',
            description: 'Core wedding coverage — select included photos from the full gallery.',
            basePrice: 25000,
            workflowMode: 'SELECT_ONLY',
            includedPhotos: 40,
            pricePerExtraPhoto: 250,
            sortOrder: 0,
          },
          {
            name: 'Wedding Premium',
            slug: 'wedding-premium',
            description: 'Extended wedding package with more included selects.',
            basePrice: 50000,
            workflowMode: 'SELECT_ONLY',
            includedPhotos: 80,
            pricePerExtraPhoto: 200,
            sortOrder: 1,
          },
          {
            name: 'Portrait',
            slug: 'portrait',
            description: 'Studio / outdoor portraits with download access.',
            basePrice: 8000,
            workflowMode: 'SELECT_AND_DOWNLOAD',
            includedPhotos: 10,
            pricePerExtraPhoto: 150,
            sortOrder: 2,
          },
          {
            name: 'Custom',
            slug: 'custom',
            description: 'Flexible package — set terms per client.',
            basePrice: 0,
            workflowMode: 'SELECT_ONLY',
            includedPhotos: 20,
            pricePerExtraPhoto: 200,
            sortOrder: 3,
          },
        ],
      },
    },
  });

  console.log('──────────────────────────────────────────────');
  console.log('Seeded studio:', studio.id);
  console.log('Admin email   :', adminEmail);
  console.log('Admin password:', adminPassword, '  ← store securely; shown once');
  console.log('──────────────────────────────────────────────');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
