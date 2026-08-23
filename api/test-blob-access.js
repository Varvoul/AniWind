// Test endpoint to find the correct blob access mode
import { put, head, del } from '@vercel/blob';

export default async function handler(req, res) {
  const testKey = 'cache/test-access-mode.json';
  const testData = JSON.stringify({ test: true, time: new Date().toISOString(), mode: 'test' });
  
  const results = {};
  
  // Test 1: No access parameter
  try {
    const r1 = await put(testKey + '-none', testData, { 
      contentType: 'application/json', 
      addRandomSuffix: false 
    });
    results.no_access = { success: true, size: r1.size };
    // Cleanup
    try { await del(testKey + '-none'); } catch {}
  } catch (e) {
    results.no_access = { success: false, error: e.message };
  }
  
  // Test 2: Public access
  try {
    const r2 = await put(testKey + '-pub', testData, { 
      access: 'public',
      contentType: 'application/json', 
      addRandomSuffix: false 
    });
    results.public = { success: true, size: r2.size };
    try { await del(testKey + '-pub'); } catch {}
  } catch (e) {
    results.public = { success: false, error: e.message };
  }
  
  // Test 3: Private access
  try {
    const r3 = await put(testKey + '-priv', testData, { 
      access: 'private',
      contentType: 'application/json', 
      addRandomSuffix: false 
    });
    results.private = { success: true, size: r3.size };
    try { await del(testKey + '-priv'); } catch {}
  } catch (e) {
    results.private = { success: false, error: e.message };
  }
  
  return res.json({
    test_completed: true,
    store_id: 'store_VcHlC7LrB4RyYVJn',
    timestamp: new Date().toISOString(),
    results,
    recommendation: results.private?.success ? 'Use private' : 
                     results.public?.success ? 'Use public' : 
                     results.no_access?.success ? 'Use no access' : 'NONE WORK - check store config'
  });
}
