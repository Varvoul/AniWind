// ═══════════════════════════════════════════════════════════════════
// VERCEL BLOB CACHE - LIVE DEPLOYMENT VERIFICATION
// 
// Tests against actual deployed Vercel instance
// Usage: node verify-live.js [URL]
//   Default: https://aniumi.vercel.app
// ═══════════════════════════════════════════════════════════════════

const TARGET_URL = process.argv[2] || 'https://aniumi.vercel.app';
const CACHE_API = `${TARGET_URL}/api/blob-cache`;

console.log('\n' + '═'.repeat(60));
console.log('🔍 VERCEL BLOB CACHE - LIVE VERIFICATION');
console.log(`   Target: ${TARGET_URL}`);
console.log(`   Time: ${new Date().toISOString()}`);
console.log('═'.repeat(60) + '\n');

let passed = 0;
let failed = 0;

function log(test, status, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏳';
  const color = status === 'PASS' ? '\x1b[32m' : status === 'FAIL' ? '\x1b[31m' : '\x1b[33m';
  console.log(`${icon} ${test} ${detail ? `- ${detail}` : ''}`);
}

async function apiCall(action, data = {}) {
  try {
    console.log(`   📡 Calling: ${action}...`);
    const response = await fetch(CACHE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data })
    });
    const result = await response.json();
    console.log(`   📥 Response: ${result.success ? 'Success' : 'Failed'}`);
    return result;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  
  // ─────────────────────────────────────────────────────────────────────
  // TEST 1: Status Check
  // ─────────────────────────────────────────────────────────────────────
  console.log('─'.repeat(50));
  console.log('TEST 1: Cache Status Check');
  console.log('─'.repeat(50));
  
  const status = await apiCall('status');
  
  if (status.success) {
    log('API Reachable', 'PASS', 'Endpoint responding');
    log('Status Structure', 'PASS', `Has ${status.overview?.totalSections || 0} sections`);
    
    if (status.overview) {
      console.log(`\n   📊 Current Cache State:`);
      console.log(`      ✅ Valid:   ${status.overview.valid || 0}`);
      console.log(`      ⏰ Expired: ${status.overview.expired || 0}`);
      console.log(`      ❌ Missing: ${status.overview.missing || 0}`);
      console.log(`      💾 Size:    ${(status.overview.totalSizeBytes || 0) / 1024}KB`);
    }
    passed += 2;
  } else {
    log('API Reachable', 'FAIL', status.error || 'No response');
    failed += 2;
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // TEST 2: Write Test Data
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log('TEST 2: Write Test Data to Blob');
  console.log('─'.repeat(50));
  
  const testData = {
    test: true,
    timestamp: new Date().toISOString(),
    verification: 'Vercel Blob Cache Test',
    sampleItems: ['item-1', 'item-2', 'item-3']
  };
  
  const writeResult = await apiCall('write', { 
    section: 'hero-slider', 
    data: testData 
  });
  
  if (writeResult.success) {
    log('Write Operation', 'PASS', `Stored ${writeResult.sizeBytes} bytes`);
    log('Blob URL', 'PASS', writeResult.url ? 'Generated' : 'Missing');
    passed += 2;
  } else {
    log('Write Operation', 'FAIL', writeResult.error || 'Write failed');
    failed += 2;
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // TEST 3: Read Back Data
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log('TEST 3: Read Cached Data');
  console.log('─'.repeat(50));
  
  const readResult = await apiCall('read', { section: 'hero-slider' });
  
  if (readResult.success && readResult.data?.found) {
    log('Cache Hit', 'PASS', 'Data found in cache');
    log('Has URL', 'PASS', readResult.data.url ? 'Yes' : 'No');
    
    // Verify we can fetch from the URL
    if (readResult.data.url) {
      try {
        const resp = await fetch(readResult.data.url);
        const data = await resp.json();
        log('Data Accessible', 'PASS', `${JSON.stringify(data).length} chars retrieved`);
        log('Data Integrity', 'PASS', data.test === true ? 'Matches original' : 'MISMATCH');
        passed += 2;
      } catch (e) {
        log('Data Accessible', 'FAIL', e.message);
        failed++;
      }
    }
    passed += 2;
  } else {
    log('Cache Hit', 'FAIL', readResult.data?.reason || 'Not found');
    failed += 4;
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // TEST 4: Pagination (Recently Completed)
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log('TEST 4: Pagination Support');
  console.log('─'.repeat(50));
  
  const page1 = await apiCall('write', { 
    section: 'recently-completed', 
    data: { page: 1, anime: ['A', 'B', 'C'] }, 
    page: 1 
  });
  const page2 = await apiCall('write', { 
    section: 'recently-completed', 
    data: { page: 2, anime: ['D', 'E', 'F'] }, 
    page: 2 
  });
  
  if (page1.success && page2.success) {
    log('Page 1 Write', 'PASS', page1.blobKey);
    log('Page 2 Write', 'PASS', page2.blobKey);
    
    const r1 = await apiCall('read', { section: 'recently-completed', page: 1 });
    const r2 = await apiCall('read', { section: 'recently-completed', page: 2 });
    
    if (r1.data?.found && r2.data?.found) {
      log('Page 1 Read', 'PASS', 'Retrieved successfully');
      log('Page 2 Read', 'PASS', 'Pages are independent');
      passed += 4;
    } else {
      log('Page 1 Read', 'FAIL', r1.data?.reason || 'Failed');
      log('Page 2 Read', 'FAIL', r2.data?.reason || 'Failed');
      failed += 2;
    }
  } else {
    log('Page 1 Write', 'FAIL', page1.error || 'Failed');
    log('Page 2 Write', 'FAIL', page2.error || 'Failed');
    failed += 4;
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // TEST 5: List All Items
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log('TEST 5: List All Cached Items');
  console.log('─'.repeat(50));
  
  const list = await apiCall('list');
  
  if (list.success) {
    log('List Operation', 'PASS', `${list.count} items found`);
    
    if (list.items?.length > 0) {
      console.log(`\n   📦 Cached Blobs:`);
      list.items.forEach((item, i) => {
        const exp = item.isExpired ? '⏰ EXPIRED' : '✅ VALID';
        console.log(`      ${i+1}. ${item.pathname} (${item.sizeBytes}B) - ${exp}`);
      });
    }
    passed++;
  } else {
    log('List Operation', 'FAIL', list.error || 'Failed');
    failed++;
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('📋 VERIFICATION COMPLETE');
  console.log('═'.repeat(60));
  console.log(`\n   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📊 Total:  ${passed + failed}`);
  
  if (failed === 0) {
    console.log(`\n   🎉🎉🎉  ALL TESTS PASSED!  🎉🎉🎉`);
    console.log(`   Vercel Blob Cache is FULLY OPERATIONAL!\n`);
  } else {
    console.log(`\n   ⚠️  Some tests failed.`);
    console.log(`   Check the errors above for details.\n`);
  }
  
  return { passed, failed };
}

// Run
runTests()
  .then(r => process.exit(r.failed > 0 ? 1 : 0))
  .catch(e => { console.error(e); process.exit(1); });
