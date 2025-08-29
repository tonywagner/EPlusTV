# ESPN Handler Debug Scripts

This directory contains all testing and debugging scripts specific to the ESPN handler and ESPN Ultimate functionality.

## Available Scripts

### test-espn-handler.ts
Main ESPN handler testing script with multiple commands:

```bash
# Show all available commands
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts help

# Initialize the ESPN handler
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts initialize

# Test schedule fetching
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts getSchedule

# Test token refresh
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts refreshTokens

# Test in-market teams refresh
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts refreshInMarketTeams

# Test ISP access
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts testIspAccess

# Test ESPN Ultimate functionality
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts testUltimate
```

## ESPN Ultimate Testing Scripts

### test-ultimate-linear.ts
Tests the complete ESPN Ultimate authentication flow for linear channels:

```bash
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-ultimate-linear.ts
```

This script:
- Enables ESPN Ultimate subscription
- Tests BAM token authentication for linear channels
- Demonstrates the authentication flow differences
- Shows how Ultimate bypasses Adobe Pass requirements

### test-ultimate-simple.ts
Simple toggle test for ESPN Ultimate functionality:

```bash
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-ultimate-simple.ts
```

This script:
- Tests Ultimate subscription enable/disable
- Verifies database persistence
- Shows basic Ultimate functionality

### test-ultimate-subscription.ts
Comprehensive ESPN Ultimate subscription testing:

```bash
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-ultimate-subscription.ts
```

This script:
- Tests Ultimate subscription with various states
- Verifies the `isEnabled('ultimate')` function
- Tests database integration

### test-with-real-tokens.ts
Testing script for using real ESPN authentication tokens:

```bash
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-with-real-tokens.ts
```

This script:
- Demonstrates how to inject real ESPN tokens
- Tests authentication with actual credentials  
- Validates token expiration and refresh
- Tests both BAM and Adobe Pass tokens
- Includes comprehensive error handling

## Usage Notes

1. **Token Setup**: For real authentication testing, create a `test-tokens.json` file in the project root with your ESPN credentials
2. **Authentication Types**: Scripts test both BAM tokens (ESPN+) and Adobe Pass tokens (linear TV)
3. **Ultimate Testing**: Ultimate functionality requires valid ESPN+ BAM tokens
4. **Error Handling**: All scripts include proper error handling and detailed logging

## Authentication Flow Testing

The scripts in this directory specifically test:

- **BAM Token Flow**: Disney+/ESPN+ authentication for on-demand and Ultimate content
- **Adobe Pass Flow**: Traditional TV provider authentication for linear channels  
- **Ultimate Authentication**: How Ultimate subscribers can use BAM tokens for linear channels
- **Token Refresh**: Automatic token renewal and expiration handling
- **Dual Authentication**: Running both BAM and Adobe authentication systems simultaneously

## ESPN Ultimate Debugging Insights

### Understanding Linear Event Processing

ESPN Ultimate linear channels have complex dependency logic:

```bash
# Diagnostic command to check all ESPN Ultimate dependencies
npx ts-node -r tsconfig-paths/register -e "
import {db} from './services/database';
import {usesLinear} from './services/misc-db-service';
(async () => {
  // Check global linear setting
  const useLinear = await usesLinear();
  console.log('1. Global use_linear setting:', useLinear);
  
  // Check ESPN+ provider and Ultimate subscription
  const espnplus = await db.providers.findOneAsync({name: 'espnplus'});
  console.log('2. ESPN+ enabled:', espnplus?.enabled);
  console.log('3. Ultimate subscription:', espnplus?.meta?.ultimate_subscription);
  
  // Check ESPN linear provider
  const espn = await db.providers.findOneAsync({name: 'espn'});
  console.log('4. ESPN linear provider enabled:', espn?.enabled);
  console.log('5. Linear channels configured:', espn?.linear_channels?.length || 0);
  
  const enabledChannels = espn?.linear_channels?.filter(c => c.enabled) || [];
  console.log('6. Enabled linear channels:', enabledChannels.length);
  
  // Check entry results
  const totalEntries = await db.entries.countAsync({from: 'espn'});
  const linearEntries = await db.entries.countAsync({from: 'espn', linear: true});
  console.log('7. Total ESPN entries:', totalEntries);
  console.log('8. Linear ESPN entries:', linearEntries);
  
  // Logic check
  const ultimateEnabled = espnplus?.meta?.ultimate_subscription && espnplus?.enabled;
  const shouldProcessLinear = (useLinear || ultimateEnabled) && espn?.enabled && enabledChannels.length > 0;
  console.log('\\n🔍 Should process linear channels:', shouldProcessLinear);
  
  if (shouldProcessLinear && linearEntries === 0) {
    console.log('⚠️  Expected linear processing but found 0 linear entries');
    console.log('💡 Check parseAirings function and LINEAR_NETWORKS array');
  }
})();
"
```

### Network ID Mapping Issues

ESPN's API returns network names (e.g., 'ESPN', 'ESPN2') but the code may expect network IDs. 

**Debug Pattern**:
```bash
# Check what network data is actually in events
npx ts-node -r tsconfig-paths/register -e "
import {db} from './services/database';
(async () => {
  const entries = await db.entries.findAsync({from: 'espn'}, {limit: 10});
  const networks = [...new Set(entries.map(e => e.network))].sort();
  console.log('Actual network values in database:');
  networks.forEach(net => console.log(\`- \${net}\`));
  
  // Check for channel field (linear events only)
  const linearEntries = entries.filter(e => e.channel);
  if (linearEntries.length > 0) {
    const channels = [...new Set(linearEntries.map(e => e.channel))].sort();
    console.log('\\nLinear channel IDs:');
    channels.forEach(ch => console.log(\`- \${ch}\`));
  }
})();
"
```

### Authentication State Verification

When ESPN Ultimate isn't working as expected:

```bash
# Complete authentication state check
npx ts-node -r tsconfig-paths/register -e "
import {db} from './services/database';
import jwt_decode from 'jwt-decode';

async function debugEspnAuth() {
  const espnplus = await db.providers.findOneAsync({name: 'espnplus'});
  const espn = await db.providers.findOneAsync({name: 'espn'});
  
  console.log('📊 ESPN Authentication Debug Report');
  console.log('===================================');
  
  // BAM Token Status
  console.log('\\n🎯 BAM Tokens (ESPN+/Ultimate):');
  console.log('ESPN+ enabled:', espnplus?.enabled);
  console.log('Ultimate subscription:', espnplus?.meta?.ultimate_subscription);
  console.log('Has BAM tokens:', !!espnplus?.tokens?.tokens);
  
  if (espnplus?.tokens?.tokens?.id_token) {
    try {
      const decoded = jwt_decode(espnplus.tokens.tokens.id_token);
      const expires = new Date(decoded.exp * 1000);
      const isValid = expires > new Date();
      console.log('ID token expires:', expires.toLocaleString());
      console.log('ID token valid:', isValid);
    } catch (e) {
      console.log('❌ Could not decode ID token');
    }
  }
  
  // Adobe Pass Status
  console.log('\\n📺 Adobe Pass Tokens (Linear TV):');
  console.log('ESPN linear enabled:', espn?.enabled);
  console.log('Adobe device ID:', !!espn?.tokens?.adobe_device_id);
  console.log('Adobe auth token:', !!espn?.tokens?.adobe_auth);
  
  if (espn?.tokens?.adobe_auth?.expires) {
    const adobeExpires = new Date(espn.tokens.adobe_auth.expires);
    const adobeValid = adobeExpires > new Date();
    console.log('Adobe token expires:', adobeExpires.toLocaleString());
    console.log('Adobe token valid:', adobeValid);
  }
  
  // Ultimate Logic Check
  const ultimateEnabled = (espnplus?.meta?.ultimate_subscription && espnplus?.enabled);
  console.log('\\n🏆 Ultimate Status:');
  console.log('Ultimate enabled:', ultimateEnabled);
  
  if (ultimateEnabled) {
    console.log('✅ Ultimate should allow BAM auth for linear channels');
  } else if (!espnplus?.enabled) {
    console.log('⚠️  ESPN+ not enabled - Ultimate requires ESPN+ to be enabled');
  } else if (!espnplus?.meta?.ultimate_subscription) {
    console.log('⚠️  Ultimate subscription not enabled');
  }
}

debugEspnAuth().catch(console.error);
"
```

For detailed information about token extraction and setup, see the main `debug/README.md` file.