import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const projectId = 'cmos2bycj0000f7zwaw6n84oq';

  const rank = await prisma.rank.findFirst({
    where: { projectId }
  });

  if (!rank) {
    console.log('No rank found. Please create one first in Project Setup.');
    return;
  }

  console.log('Found rank:', rank.labelEn, rank.id);

  const result = await prisma.stack.updateMany({
    where: { block: { projectId } },
    data: { rankId: rank.id }
  });

  console.log('Updated', result.count, 'stacks');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
