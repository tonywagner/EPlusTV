#!/usr/bin/env node

/**
 * Test script for ESPN with real authentication tokens
 * This script demonstrates how to test the ESPN handler with valid credentials
 */

import {espnHandler} from '../../services/espn-handler';
import {db} from '../../services/database';
import {IProvider} from '../../services/shared-interfaces';
import {TESPNPlusTokens, IEspnPlusMeta} from '../../services/espn-handler';

interface TestTokens {
  // BAM tokens for ESPN+ / Ultimate
  bam?: {
    access_token: string;
    refresh_token: string;
    id_token: string;
    expires_in: number;
    ttl: number;
    refresh_ttl: number;
    swid: string;
  };

  // Adobe Pass tokens for linear TV
  adobe?: {
    adobe_device_id: string;
    adobe_auth: {
      access_token: string;
      expires: string;
      mvpd: string;
    };
  };
}

async function setupTestTokens() {
  console.log('🔧 Setting up test tokens...');

  // Check if we have the REAL_TOKENS environment variable or config file
  const realTokensFile = process.env.REAL_TOKENS_FILE || './test-tokens.json';

  try {
    console.log(`📁 Looking for real tokens in: ${realTokensFile}`);
    console.log('💡 Create a test-tokens.json file with your real ESPN tokens to test with actual authentication');
    console.log('   See debug/README.md for instructions on how to extract tokens');

    // For security, don't include real tokens in the code
    console.log('\n📝 Example test-tokens.json structure:');
    console.log(`{
  "bam": {
    "access_token": "eyJ...",
    "refresh_token": "eyJ...",
    "id_token": "eyJ...",
    "expires_in": 3600,
    "ttl": ${Date.now() + 3600000},
    "refresh_ttl": ${Date.now() + 7200000},
    "swid": "your_swid_here"
  },
  "adobe": {
    "adobe_device_id": "your_adobe_device_id",
    "adobe_auth": {
      "access_token": "your_adobe_token",
      "expires": "2024-12-31T23:59:59Z",
      "mvpd": "your_provider_code"
    }
  }
}`);

    // Try to load real tokens
    let tokens: TestTokens = {};
    try {
      const fs = await import('fs');
      if (fs.existsSync(realTokensFile)) {
        tokens = JSON.parse(fs.readFileSync(realTokensFile, 'utf8'));
        console.log('✅ Real tokens loaded from file');
      } else {
        console.log('⚠️  No real tokens file found - running without authentication');
        return false;
      }
    } catch (error) {
      console.log('⚠️  Could not load real tokens - running without authentication');
      return false;
    }

    // Inject BAM tokens for ESPN+
    if (tokens.bam) {
      await db.providers.updateAsync(
        {name: 'espnplus'},
        {
          $set: {
            enabled: true,
            'tokens.tokens': tokens.bam,
          },
        },
      );
      console.log('✅ BAM tokens injected for ESPN+');
    }

    // Inject Adobe tokens for linear TV
    if (tokens.adobe) {
      await db.providers.updateAsync(
        {name: 'espn'},
        {
          $set: {
            enabled: true,
            'tokens.adobe_auth': tokens.adobe.adobe_auth,
            'tokens.adobe_device_id': tokens.adobe.adobe_device_id,
          },
        },
      );
      console.log('✅ Adobe Pass tokens injected for linear TV');
    }

    return true;
  } catch (error) {
    console.error('❌ Failed to setup tokens:', error.message);
    return false;
  }
}

async function testBasicFunctionality() {
  console.log('\n🧪 Testing basic ESPN functionality...');

  try {
    await espnHandler.initialize();
    console.log('✅ ESPN handler initialized');

    // Test token refresh
    console.log('\n🔄 Testing token refresh...');
    await espnHandler.refreshTokens();
    console.log('✅ Token refresh completed');

    // Test schedule access
    console.log('\n📅 Testing schedule access...');
    await espnHandler.getSchedule();
    console.log('✅ Schedule access working');

    return true;
  } catch (error) {
    console.error('❌ Basic functionality test failed:', error.message);
    return false;
  }
}

async function testUltimateSubscription() {
  console.log('\n🎯 Testing ESPN Ultimate functionality...');

  try {
    // Enable Ultimate subscription
    await db.providers.updateAsync({name: 'espnplus'}, {$set: {enabled: true, 'meta.ultimate_subscription': true}});

    // Test Ultimate functionality
    const {enabled: espnPlusEnabled, meta: plusMeta} = await db.providers.findOneAsync<
      IProvider<TESPNPlusTokens, IEspnPlusMeta>
    >({name: 'espnplus'});

    const isUltimateEnabled = (plusMeta?.ultimate_subscription ? true : false) && espnPlusEnabled;

    console.log('✅ ESPN+ enabled:', espnPlusEnabled);
    console.log('✅ Ultimate subscription:', plusMeta?.ultimate_subscription);
    console.log('✅ Ultimate functionality active:', isUltimateEnabled);

    if (isUltimateEnabled) {
      console.log('\n🏆 ESPN Ultimate is active - linear channels will use BAM authentication');
      console.log('   This means linear ESPN channels can be accessed with ESPN+ credentials');
      console.log('   instead of requiring traditional TV provider authentication');
    }

    return true;
  } catch (error) {
    console.error('❌ Ultimate subscription test failed:', error.message);
    return false;
  }
}

async function testTokenValidation() {
  console.log('\n🔍 Validating token status...');

  try {
    const jwt_decode = await import('jwt-decode');

    // Check ESPN+ tokens
    const espnplus = await db.providers.findOneAsync({name: 'espnplus'});
    if (espnplus?.tokens?.tokens?.id_token) {
      try {
        const decoded: any = jwt_decode.default(espnplus.tokens.tokens.id_token);
        const expires = new Date(decoded.exp * 1000);
        const isValid = expires > new Date();

        console.log('✅ ESPN+ ID token found');
        console.log('   Expires:', expires.toLocaleString());
        console.log('   Valid:', isValid ? 'Yes' : 'No (expired)');

        if (!isValid) {
          console.log('⚠️  Token is expired - refresh may be needed');
        }
      } catch (e) {
        console.log('❌ Could not decode ESPN+ ID token');
      }
    } else {
      console.log('⚠️  No ESPN+ ID token found');
    }

    // Check Adobe tokens
    const espn = await db.providers.findOneAsync({name: 'espn'});
    console.log('✅ Adobe device ID present:', !!espn?.tokens?.adobe_device_id);
    console.log('✅ Adobe auth token present:', !!espn?.tokens?.adobe_auth);

    if (espn?.tokens?.adobe_auth?.expires) {
      const adobeExpires = new Date(espn.tokens.adobe_auth.expires);
      const adobeValid = adobeExpires > new Date();
      console.log('   Adobe token expires:', adobeExpires.toLocaleString());
      console.log('   Adobe token valid:', adobeValid ? 'Yes' : 'No (expired)');
    }

    return true;
  } catch (error) {
    console.error('❌ Token validation failed:', error.message);
    return false;
  }
}

async function main() {
  console.log('🧪 ESPN Real Token Testing Script');
  console.log('=====================================\n');

  try {
    // Setup tokens
    const hasTokens = await setupTestTokens();

    // Run tests
    const basicTest = await testBasicFunctionality();
    const ultimateTest = await testUltimateSubscription();
    const validationTest = await testTokenValidation();

    // Summary
    console.log('\n📊 Test Results Summary:');
    console.log('========================');
    console.log('Real tokens loaded:', hasTokens ? 'Yes' : 'No');
    console.log('Basic functionality:', basicTest ? 'Pass' : 'Fail');
    console.log('Ultimate subscription:', ultimateTest ? 'Pass' : 'Fail');
    console.log('Token validation:', validationTest ? 'Pass' : 'Fail');

    if (!hasTokens) {
      console.log('\n💡 To test with real ESPN authentication:');
      console.log('1. Create a test-tokens.json file with your ESPN tokens');
      console.log('2. See debug/README.md for token extraction instructions');
      console.log('3. Or use the web UI at http://localhost:8000 to login');
    }

    console.log('\n🎉 Testing complete!');
  } catch (error) {
    console.error('❌ Test execution failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

if (require.main === module) {
  main();
}
