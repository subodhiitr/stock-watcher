const fs = require('fs');
const path = require('path');

// Load latest snapshot
const snapshotFile = path.join(__dirname, 'snapshots', 'simulation_snapshots_2026-06-25.json');
if (!fs.existsSync(snapshotFile)) {
  console.error('Snapshot file not found');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(snapshotFile, 'utf-8'));
const snap = data.snapshots[data.snapshots.length - 1];

console.log('\n' + '='.repeat(70));
console.log('SECTOR-LEVEL REGIME VERIFICATION');
console.log('='.repeat(70));

// Check sector data in candidates
const candidatesWithSector = snap.candidates.filter(c => c.marketContext?.sectorAvg != null);
const candidatesWithoutSector = snap.candidates.filter(c => !c.marketContext?.sectorAvg);

console.log(\\nTotal candidates: \\);
console.log(\Candidates WITH sector data: \\);
console.log(\Candidates WITHOUT sector data: \\);

// Show sample with sector data
if (candidatesWithSector.length > 0) {
  console.log('\n✅ Sample candidates with sector data:');
  candidatesWithSector.slice(0, 5).forEach(c => {
    const reason = c.blockReason || 'none';
    const sectorRule = reason.includes('sector') ? '(BLOCKED by sector)' : '';
    console.log(\  \ (\): sectorAvg=\% \\);
  });
}

// Count sector blocks
const sectorBlocked = snap.candidates.filter(c => c.blockReason?.includes('sector'));
console.log(\\nSector-based blocks: \\);

if (sectorBlocked.length > 0) {
  console.log('Examples:');
  sectorBlocked.slice(0, 3).forEach(c => {
    console.log(\  \: \\);
  });
}

// Overall status
console.log('\n' + '='.repeat(70));
console.log('STATUS:');
if (candidatesWithSector.length > 0 && candidatesWithoutSector.length === 0) {
  console.log('✅ SECTOR-LEVEL REGIME CHECK IS WORKING');
} else if (candidatesWithoutSector.length > 0) {
  console.log('⚠️  Some candidates missing sector data - may need app reload');
} else {
  console.log('❌ No candidates captured - check if simulation is running');
}
console.log('='.repeat(70) + '\n');
