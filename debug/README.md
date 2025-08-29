# Debug Scripts for EPlusTV Handlers

This directory contains debugging utilities for testing and developing individual handler components.

## Available Scripts

## ESPN Handler Testing Scripts

All ESPN-specific testing scripts are located in the `debug/espn-handler/` directory:

### test-espn-handler.ts
Comprehensive testing script for ESPN handler with multiple commands:

```bash
# Show available commands
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts help

# Initialize the ESPN handler
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts initialize

# Test schedule fetching
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts getSchedule

# Test token refresh
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts refreshTokens

# Test ESPN Ultimate functionality
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts testUltimate
```

### ESPN Ultimate Testing Scripts
Specific tests for ESPN Ultimate subscription functionality:

```bash
# Test Ultimate authentication flow
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-ultimate-linear.ts

# Simple Ultimate toggle test
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-ultimate-simple.ts

# Complete Ultimate subscription test
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-ultimate-subscription.ts

# Test with real ESPN credentials
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-with-real-tokens.ts
```

### quick-test.ts
Rapid prototyping script for testing specific functionality:

```bash
# Run quick tests (modify the script directly for your needs)
npx ts-node -r tsconfig-paths/register debug/quick-test.ts
```

## Creating Handler Debug Scripts

**📖 For complete provider development guide, see [ARCHITECTURE.md](./ARCHITECTURE.md#how-to-add-a-new-provider)**

To create debug scripts for other handlers, follow this pattern:

```typescript
import {handlerName} from '../../services/handler-name';

async function testFunction() {
  await handlerName.initialize();
  await handlerName.someMethod();
}

if (require.main === module) {
  testFunction().catch(console.error);
}
```

**Recommended Structure:**
- Create `debug/[provider]-handler/` directory for each provider
- Follow ESPN handler debug script patterns
- Test authentication flows, token refresh, and error handling

## Testing with Real ESPN Authentication

### Understanding ESPN Token System

**📖 For comprehensive authentication architecture, see [ARCHITECTURE.md](./ARCHITECTURE.md#authentication-architecture-deep-dive)**

ESPN uses a dual token system:
- **BAM tokens** (Disney+/ESPN+ subscription): For on-demand content and Ultimate linear channels
- **Adobe Pass tokens** (TV provider): For traditional linear ESPN channels
- **ESPN Ultimate**: Premium tier allowing BAM tokens for linear channels

### Method 1: Using the Web UI (Recommended)

The easiest way to get valid tokens for testing:

```bash
# Start the server
npm start

# Navigate to http://localhost:8000
# Click on ESPN+ provider and log in with your Disney+ credentials
# The tokens will be automatically saved and can be used for testing
```

### Method 2: Manual Token Injection

If you have valid ESPN tokens from other sources, you can inject them directly:

#### BAM Tokens (ESPN+ / Disney+)
Create or modify `config/espn_plus_tokens.json`:

```json
{
  "tokens": {
    "access_token": "your_access_token_here",
    "refresh_token": "your_refresh_token_here", 
    "id_token": "your_id_token_here",
    "expires_in": 3600,
    "ttl": 1234567890,
    "refresh_ttl": 1234567890,
    "swid": "your_swid_here"
  },
  "device_grant": {
    "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
    "assertion": "your_device_assertion_here"
  }
}
```

#### Adobe Pass Tokens (Linear TV)
Create or modify `config/espn_linear_tokens.json`:

```json
{
  "adobe_device_id": "your_adobe_device_id",
  "adobe_auth": {
    "access_token": "your_adobe_access_token",
    "expires": "2024-12-31T23:59:59Z",
    "mvpd": "your_tv_provider_code"
  }
}
```

### Method 3: Extracting Tokens from Browser

#### For BAM Tokens (ESPN+):

1. **Login to ESPN+ in browser**: Go to https://plus.espn.com/ and log in
2. **Open Developer Tools**: Press F12 → Network tab
3. **Filter requests**: Filter by "bamgrid" or "disney"  
4. **Find token requests**: Look for requests to `registerdisney.go.com` or `bamgrid.com`
5. **Extract tokens**: Copy tokens from response JSON

Example curl command to test BAM token:
```bash
# Test BAM API access
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
     -H "User-Agent: ESPN/6.0.0" \
     "https://bam-sdk-configs.bamgrid.com/bam-sdk/v2.0/espn-a9b93989/browser/v3.4/linux/chrome/prod.json"
```

#### For Adobe Pass Tokens (Linear TV):

1. **Login to linear ESPN**: Go to https://www.espn.com/watch/ with TV provider
2. **Open Developer Tools**: Press F12 → Network tab  
3. **Find Adobe requests**: Look for requests containing "adobe" or "pass"
4. **Extract device ID**: Look in localStorage for `adobe_device_id`

Example curl command to test Adobe token:
```bash
# Test Adobe Pass authentication
curl -X POST "https://api.auth.adobe.com/api/v1/tokens/authn" \
     -H "Authorization: Bearer YOUR_ADOBE_TOKEN" \
     -H "User-Agent: ESPN/6.0.0"
```

### Method 4: Database Direct Injection

You can also inject tokens directly into the NeDB database:

```bash
# Test database token injection
npx ts-node -r tsconfig-paths/register -e "
import {db} from './services/database';

async function injectTokens() {
  // Inject ESPN+ tokens
  await db.providers.updateAsync(
    {name: 'espnplus'}, 
    {\$set: {
      enabled: true,
      'tokens.tokens': {
        access_token: 'your_token_here',
        refresh_token: 'your_refresh_token_here',
        id_token: 'your_id_token_here',
        // ... other token fields
      }
    }}
  );
  
  console.log('✅ Tokens injected successfully');
}

injectTokens().catch(console.error);
"
```

### Testing Token Validity

Once you have tokens in place, test them:

```bash
# Test ESPN+ token validity
npx ts-node -r tsconfig-paths/register -e "
import {espnHandler} from './services/espn-handler';

async function testTokens() {
  await espnHandler.initialize();
  
  // Test basic functionality
  await espnHandler.refreshTokens();
  console.log('✅ Token refresh test complete');
  
  // Test schedule access
  await espnHandler.getSchedule();  
  console.log('✅ Schedule access test complete');
}

testTokens().catch(console.error);
"
```

### Troubleshooting Token Issues

#### Common Error Messages:
- `"Could not get auth refresh token"` → BAM refresh token expired/invalid
- `"Could not get BAM access token"` → ID token or device grant invalid  
- `"Could not get provider token data"` → Adobe Pass authentication failed
- `"Authorization failed"` → Token doesn't have required permissions

#### Debug Token Status:
```bash
# Check current token status
npx ts-node -r tsconfig-paths/register -e "
import {db} from './services/database';
import jwt_decode from 'jwt-decode';

async function debugTokens() {
  const espnplus = await db.providers.findOneAsync({name: 'espnplus'});
  const espn = await db.providers.findOneAsync({name: 'espn'});
  
  console.log('ESPN+ enabled:', espnplus?.enabled);
  console.log('ESPN+ has tokens:', !!espnplus?.tokens?.tokens);
  
  if (espnplus?.tokens?.tokens?.id_token) {
    try {
      const decoded = jwt_decode(espnplus.tokens.tokens.id_token);
      console.log('ID token expires:', new Date(decoded.exp * 1000));
    } catch (e) {
      console.log('Could not decode ID token');
    }
  }
  
  console.log('Adobe device ID:', espn?.tokens?.adobe_device_id ? 'Present' : 'Missing');
  console.log('Adobe auth token:', espn?.tokens?.adobe_auth ? 'Present' : 'Missing');
}

debugTokens().catch(console.error);
"
```

## Tips for Handler Development

1. **Always initialize first**: Most handlers require `initialize()` to be called before other methods
2. **Use the debug scripts**: They provide better error handling and context than running handlers directly
3. **Check database state**: Many handlers rely on database configuration stored in NeDB
4. **Mock data when needed**: Use the quick-test.ts script to test with mock data during development
5. **Test with real tokens**: Use the authentication methods above to test with actual ESPN credentials