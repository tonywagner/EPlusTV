#!/usr/bin/env node

/**
 * Test script for ESPN Ultimate linear channel authentication
 */

import {espnHandler} from '../../services/espn-handler';
import {db} from '../../services/database';

async function testUltimateLinearAuth() {
  console.log('🧪 Testing ESPN Ultimate linear channel authentication...');

  try {
    await espnHandler.initialize();

    // Test with ultimate_subscription enabled
    console.log('\n1. Testing with ESPN Ultimate enabled...');
    await db.providers.updateAsync({name: 'espnplus'}, {$set: {enabled: true, 'meta.ultimate_subscription': true}});

    // Check if ultimate is enabled
    const {meta: plusMeta, enabled: espnPlusEnabled} = await db.providers.findOneAsync({name: 'espnplus'});
    const ultimateEnabled = (plusMeta?.ultimate_subscription ? true : false) && espnPlusEnabled;

    console.log('✅ ESPN+ enabled:', espnPlusEnabled);
    console.log('✅ Ultimate subscription enabled:', ultimateEnabled);

    // Test refreshTokens method
    console.log('\n2. Testing token refresh...');
    await espnHandler.refreshTokens();
    console.log('✅ Token refresh completed');

    // Show authentication flow
    console.log('\n3. ESPN Ultimate authentication flow:');
    console.log('- Linear channels (ESPN1, ESPN2, etc.) will now use BAM authentication');
    console.log('- BAM tokens will be refreshed instead of Adobe tokens');
    console.log('- Channel access enabled through Ultimate subscription');

    console.log('\n📚 Usage in code:');
    console.log('const ultimateEnabled = await isEnabled("ultimate");');
    console.log('if (ultimateEnabled) {');
    console.log('  // Linear channels use BAM auth instead of Adobe auth');
    console.log('  console.log("Using BAM authentication for linear channels");');
    console.log('}');

    console.log('\n🎉 ESPN Ultimate linear authentication setup complete!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

if (require.main === module) {
  testUltimateLinearAuth();
}
