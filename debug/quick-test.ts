/**
 * Quick test script for rapid prototyping and debugging
 * Usage: npx ts-node -r tsconfig-paths/register debug/quick-test.ts
 */

import {espnHandler} from '../services/espn-handler';

async function quickTest() {
  console.log('🧪 Quick test starting...');

  try {
    // Your test code here
    debugger; // Breakpoint: execution will pause here when debugging
    await espnHandler.initialize();
    console.log('ESPN handler initialized successfully');

    // Example: Test specific functionality
    debugger; // Another breakpoint
    const hasIspAccess = await espnHandler.ispAccess();
    console.log('ISP Access:', hasIspAccess);
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    debugger; // Breakpoint on error
  }

  console.log('🧪 Quick test completed');
}

if (require.main === module) {
  quickTest();
}
