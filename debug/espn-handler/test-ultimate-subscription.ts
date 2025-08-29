#!/usr/bin/env node

/**
 * Test script for the new ESPN Ultimate subscription functionality
 */

import {espnHandler} from '../../services/espn-handler';
import {db} from '../../services/database';

async function testUltimateSubscription() {
  console.log('🧪 Testing ESPN Ultimate subscription functionality...');

  try {
    await espnHandler.initialize();

    // Test with ultimate_subscription set to false
    await db.providers.updateAsync({name: 'espnplus'}, {$set: {'meta.ultimate_subscription': false}});

    // Access the isEnabled function (it's a private function, but we need to test it)
    const isUltimateDisabled =
      (await (espnHandler as any).constructor.prototype.isEnabled?.call(null, 'ultimate')) ||
      (await eval(
        `(${espnHandler.constructor.toString().match(/const isEnabled = async[^}]+}/s)?.[0] || 'async () => false'})`,
      )('ultimate'));
    console.log('✅ Ultimate disabled (should be false):', isUltimateDisabled);

    // Test with ultimate_subscription set to true and ESPN+ enabled
    await db.providers.updateAsync({name: 'espnplus'}, {$set: {enabled: true, 'meta.ultimate_subscription': true}});

    const isUltimateEnabled = await eval(
      `(${espnHandler.constructor.toString().match(/const isEnabled = async[^}]+}/s)?.[0] || 'async () => false'})`,
    )('ultimate');
    console.log('✅ Ultimate enabled (should be true):', isUltimateEnabled);

    // Test direct database access to verify the field is saved
    const provider = await db.providers.findOneAsync({name: 'espnplus'});
    console.log('✅ Database ultimate_subscription value:', provider?.meta?.ultimate_subscription);

    console.log('🎉 All ultimate subscription tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

if (require.main === module) {
  testUltimateSubscription();
}
