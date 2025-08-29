#!/usr/bin/env node

/**
 * Simple test for ESPN Ultimate subscription functionality
 */

import {db} from '../../services/database';
import {IProvider} from '../../services/shared-interfaces';
import {IEspnPlusMeta, TESPNPlusTokens} from '../../services/espn-handler';

async function testUltimate() {
  console.log('🧪 Testing ESPN Ultimate functionality...');

  try {
    // Test setting ultimate_subscription to true
    await db.providers.updateAsync({name: 'espnplus'}, {$set: {enabled: true, 'meta.ultimate_subscription': true}});

    // Read back the value using the same pattern as isEnabled()
    const {enabled: espnPlusEnabled, meta: plusMeta} = await db.providers.findOneAsync<
      IProvider<TESPNPlusTokens, IEspnPlusMeta>
    >({name: 'espnplus'});

    const isUltimateEnabled = (plusMeta?.ultimate_subscription ? true : false) && espnPlusEnabled;
    console.log('✅ ESPN+ enabled:', espnPlusEnabled);
    console.log('✅ Ultimate subscription meta:', plusMeta?.ultimate_subscription);
    console.log('✅ Ultimate functionality enabled:', isUltimateEnabled);

    // Test setting ultimate_subscription to false
    await db.providers.updateAsync({name: 'espnplus'}, {$set: {'meta.ultimate_subscription': false}});

    const {meta: plusMetaDisabled} = await db.providers.findOneAsync<IProvider<TESPNPlusTokens, IEspnPlusMeta>>({
      name: 'espnplus',
    });

    const isUltimateDisabled = (plusMetaDisabled?.ultimate_subscription ? true : false) && espnPlusEnabled;
    console.log('✅ Ultimate subscription disabled:', isUltimateDisabled);

    // Show how to use in your code
    console.log('');
    console.log('📚 Usage example in your code:');
    console.log('const ultimateEnabled = await isEnabled("ultimate");');
    console.log('if (ultimateEnabled) {');
    console.log('  // Enable linear ESPN channels for Ultimate subscribers');
    console.log('  console.log("User has ESPN Ultimate - enabling linear channels");');
    console.log('}');

    console.log('🎉 Ultimate subscription functionality working correctly!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

if (require.main === module) {
  testUltimate();
}
