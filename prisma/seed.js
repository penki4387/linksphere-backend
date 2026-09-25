// Plain CommonJS on purpose: this runs as-is both in local dev (`npm run
// seed`) and inside the production container, with no ts-node dependency.
const { PrismaClient, SubscriptionTier } = require('@prisma/client');

const prisma = new PrismaClient();

const SEED_USERS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'free-user@linksphere.dev',
    subscriptionTier: SubscriptionTier.FREE,
    balanceCents: 0,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'pro-user@linksphere.dev',
    subscriptionTier: SubscriptionTier.PRO,
    balanceCents: 5000,
  },
];

const SEED_STREAMS = [
  { title: 'Late Night Coding', isActive: true, viewerCount: 128, requiredTier: SubscriptionTier.FREE },
  { title: 'Pro Subscriber AMA', isActive: true, viewerCount: 42, requiredTier: SubscriptionTier.PRO },
  { title: 'Archived Rerun', isActive: false, viewerCount: 0, requiredTier: SubscriptionTier.FREE },
];

async function main() {
  for (const user of SEED_USERS) {
    await prisma.user.upsert({ where: { id: user.id }, update: {}, create: user });
  }

  const existingStreams = await prisma.stream.count();
  if (existingStreams === 0) {
    await prisma.stream.createMany({ data: SEED_STREAMS });
  }

  console.log('Seed complete:');
  console.table(SEED_USERS.map(({ id, email, subscriptionTier }) => ({ id, email, subscriptionTier })));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
