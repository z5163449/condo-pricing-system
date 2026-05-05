import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Seed data ────────────────────────────────────────────────────────────────

const PROJECTS = [
  {
    id: 'cmo29d75n00002en6jrez2wy7',
    nameEn: 'Skyline Residences',
    nameZh: '天际豪苑',
    description: 'Premium freehold development',
    totalUnitsExpected: 320,
    roundingUnit: 1000,
    status: 'draft',
  },
  {
    id: 'cmo6k515z000054or7gtyvi2r',
    nameEn: 'One Marina Gardens',
    nameZh: '滨海花园一号',
    description: 'testing',
    totalUnitsExpected: 916,
    roundingUnit: 100,
    status: 'draft',
  },
  {
    id: 'cmo6krm280000x5u110pqgn9j',
    nameEn: 'Lentor Garden Residences',
    nameZh: '鑫丰伦多花园',
    description: null,
    totalUnitsExpected: 499,
    roundingUnit: 100,
    status: 'draft',
  },
];

const BLOCKS = [
  { id: 'cmo6k8dmc000254orrmvf0w5x', projectId: 'cmo6k515z000054or7gtyvi2r', blockName: '3',  totalStoreys: 30, startingFloor: 2, excludedFloors: '[]' },
  { id: 'cmo6k9779000454or1p6xruhg', projectId: 'cmo6k515z000054or7gtyvi2r', blockName: '5',  totalStoreys: 44, startingFloor: 2, excludedFloors: '[14,34]' },
  { id: 'cmo6kuozo0002x5u10k65xmdg', projectId: 'cmo6krm280000x5u110pqgn9j', blockName: '66', totalStoreys: 8,  startingFloor: 1, excludedFloors: '[]' },
  { id: 'cmo6kuozp0004x5u1kog2t1bb', projectId: 'cmo6krm280000x5u110pqgn9j', blockName: '68', totalStoreys: 1,  startingFloor: 1, excludedFloors: '[]' },
  { id: 'cmo6kuozq000cx5u167lqlv69', projectId: 'cmo6krm280000x5u110pqgn9j', blockName: '70', totalStoreys: 1,  startingFloor: 1, excludedFloors: '[]' },
  { id: 'cmo6kuozq0006x5u140bnubfo', projectId: 'cmo6krm280000x5u110pqgn9j', blockName: '72', totalStoreys: 1,  startingFloor: 1, excludedFloors: '[]' },
  { id: 'cmo6kuozq000ax5u1jr6yzrbb', projectId: 'cmo6krm280000x5u110pqgn9j', blockName: '74', totalStoreys: 16, startingFloor: 1, excludedFloors: '[]' },
  { id: 'cmo6kuozq0008x5u1vi2moldw', projectId: 'cmo6krm280000x5u110pqgn9j', blockName: '76', totalStoreys: 16, startingFloor: 1, excludedFloors: '[9]' },
  { id: 'cmo6kup07000ex5u15wnzp5q4', projectId: 'cmo6krm280000x5u110pqgn9j', blockName: '78', totalStoreys: 16, startingFloor: 1, excludedFloors: '[9]' },
];

const STACKS = [
  { id: 'cmo6kbuwf000654orjjuxywqi', blockId: 'cmo6k8dmc000254orrmvf0w5x', stackNumber: 1,  unitTypeCode: 'b2-m',      bedroomType: '2BR', standardSizeSqft: 650  },
  { id: 'cmo6l4l6a000gx5u1nyy6m184', blockId: 'cmo6kuozo0002x5u10k65xmdg', stackNumber: 1,  unitTypeCode: '3BR P1+S',  bedroomType: '3BR', standardSizeSqft: 969  },
  { id: 'cmo6l4l6j000sx5u1ae6o6b1b', blockId: 'cmo6kuozo0002x5u10k65xmdg', stackNumber: 7,  unitTypeCode: '3BR P3',    bedroomType: '3BR', standardSizeSqft: 1001 },
  { id: 'cmo6l4l6b000ox5u1g7xrvh1p', blockId: 'cmo6kuozo0002x5u10k65xmdg', stackNumber: 5,  unitTypeCode: '3BR P2+S',  bedroomType: '3BR', standardSizeSqft: 969  },
  { id: 'cmo6l4l6q000ux5u1ayusi0w6', blockId: 'cmo6kuozo0002x5u10k65xmdg', stackNumber: 8,  unitTypeCode: '3BR P1+S',  bedroomType: '3BR', standardSizeSqft: 969  },
  { id: 'cmo6l4l6b000mx5u1cdjso8on', blockId: 'cmo6kuozo0002x5u10k65xmdg', stackNumber: 4,  unitTypeCode: '3BR P2+S',  bedroomType: '3BR', standardSizeSqft: 969  },
  { id: 'cmo6l4l6b000qx5u1kbfa5npq', blockId: 'cmo6kuozo0002x5u10k65xmdg', stackNumber: 6,  unitTypeCode: '3BR P4',    bedroomType: '3BR', standardSizeSqft: 1001 },
  { id: 'cmo6l4l6a000kx5u1w3uexuf2', blockId: 'cmo6kuozo0002x5u10k65xmdg', stackNumber: 3,  unitTypeCode: '3BR P4',    bedroomType: '3BR', standardSizeSqft: 1001 },
  { id: 'cmo6l4l6a000ix5u1hjzpe1cx', blockId: 'cmo6kuozo0002x5u10k65xmdg', stackNumber: 2,  unitTypeCode: '3BR P3',    bedroomType: '3BR', standardSizeSqft: 1001 },
  { id: 'cmo6l9150000wx5u1bp2752vt', blockId: 'cmo6kuozp0004x5u1kog2t1bb', stackNumber: 68, unitTypeCode: 'Terrace 3', bedroomType: '5BR', standardSizeSqft: 1496 },
  { id: 'cmo6l9ks9000yx5u1bcthf3py', blockId: 'cmo6kuozq000cx5u167lqlv69', stackNumber: 70, unitTypeCode: 'Terrace 2', bedroomType: '5BR', standardSizeSqft: 1496 },
  { id: 'cmo6la6060010x5u196ik3m9a', blockId: 'cmo6kuozq0006x5u140bnubfo', stackNumber: 72, unitTypeCode: 'Terrace 1', bedroomType: '5BR', standardSizeSqft: 1496 },
  { id: 'cmo6lin5v0014x5u1zsspvhxq', blockId: 'cmo6kuozq000ax5u1jr6yzrbb', stackNumber: 9,  unitTypeCode: '2BR P3',    bedroomType: '2BR', standardSizeSqft: 678  },
  { id: 'cmo6lin6c001ex5u1v7l6wz3t', blockId: 'cmo6kuozq000ax5u1jr6yzrbb', stackNumber: 15, unitTypeCode: '2BR S1',    bedroomType: '2BR', standardSizeSqft: 732,  stackExcludedFloors: '[1]' },
  { id: 'cmo6lin5w001ax5u1hq3xm5im', blockId: 'cmo6kuozq000ax5u1jr6yzrbb', stackNumber: 13, unitTypeCode: '2BR P(HS)', bedroomType: '2BR', standardSizeSqft: 689  },
  { id: 'cmo6lin6o001ix5u1ulvm0smp', blockId: 'cmo6kuozq000ax5u1jr6yzrbb', stackNumber: 17, unitTypeCode: '4BR C2',    bedroomType: '4BR', standardSizeSqft: 1184 },
  { id: 'cmo6lin6v001kx5u1pta48bge', blockId: 'cmo6kuozq000ax5u1jr6yzrbb', stackNumber: 18, unitTypeCode: '4BR C2',    bedroomType: '4BR', standardSizeSqft: 1184 },
  { id: 'cmo6lin7i001mx5u1pin88dnj', blockId: 'cmo6kuozq000ax5u1jr6yzrbb', stackNumber: 19, unitTypeCode: '2BR S4',    bedroomType: '2BR', standardSizeSqft: 732  },
  { id: 'cmo6lin7p001ox5u1layinyt7', blockId: 'cmo6kuozq000ax5u1jr6yzrbb', stackNumber: 20, unitTypeCode: '2BR P3',    bedroomType: '2BR', standardSizeSqft: 678  },
  { id: 'cmo6lin5w0018x5u1km5vo32i', blockId: 'cmo6kuozq000ax5u1jr6yzrbb', stackNumber: 12, unitTypeCode: '4BR C2',    bedroomType: '4BR', standardSizeSqft: 1184 },
  { id: 'cmo6lin5v0016x5u1nuk1k1wo', blockId: 'cmo6kuozq000ax5u1jr6yzrbb', stackNumber: 11, unitTypeCode: '3BR P5',    bedroomType: '3BR', standardSizeSqft: 1012 },
  { id: 'cmo6lin6k001gx5u1fwjpda2l', blockId: 'cmo6kuozq000ax5u1jr6yzrbb', stackNumber: 16, unitTypeCode: '2BR P(HS)', bedroomType: '2BR', standardSizeSqft: 689  },
  { id: 'cmo6lin5w001cx5u1ee5wzbw1', blockId: 'cmo6kuozq000ax5u1jr6yzrbb', stackNumber: 14, unitTypeCode: '2BR S1',    bedroomType: '2BR', standardSizeSqft: 732  },
  { id: 'cmo6lin5v0013x5u19rwr1xrl', blockId: 'cmo6kuozq000ax5u1jr6yzrbb', stackNumber: 10, unitTypeCode: '2BR P2',    bedroomType: '2BR', standardSizeSqft: 678  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Restoring projects…');
  for (const p of PROJECTS) {
    await prisma.project.upsert({
      where:  { id: p.id },
      update: p,
      create: p,
    });
    console.log(`  ✓ Project: ${p.nameEn}`);
  }

  console.log('Restoring blocks…');
  for (const b of BLOCKS) {
    await prisma.block.upsert({
      where:  { id: b.id },
      update: b,
      create: b,
    });
    console.log(`  ✓ Block: ${b.blockName} (project ${b.projectId.slice(-6)})`);
  }

  console.log('Restoring stacks…');
  for (const s of STACKS) {
    await prisma.stack.upsert({
      where:  { id: s.id },
      update: s,
      create: s,
    });
    console.log(`  ✓ Stack #${s.stackNumber} ${s.unitTypeCode} (block ${s.blockId.slice(-6)})`);
  }

  console.log('\nDone. Restored:');
  console.log(`  ${PROJECTS.length} projects`);
  console.log(`  ${BLOCKS.length} blocks`);
  console.log(`  ${STACKS.length} stacks`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
