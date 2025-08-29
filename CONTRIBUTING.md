# Contributing to EPlusTV

## Getting Started

### Architecture

For a detail explanation of EPlusTV application's architecture see [ARCHITECTURE.md](./ARCHITECTURE.md).

### Documentation Structure

This project follows a structured documentation approach:

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Complete technical reference (authentication, database, provider patterns)
- **[debug/README.md](./debug/README.md)** - Practical testing and debugging guide (scripts, token setup)
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** - Getting started guide (setup, reverse engineering, analysis tools)

### Local Development Setup

```bash
# Install dependencies
npm install

# Start the development server
npm start

# The server will be available at http://localhost:8000
```

### Docker Development

```bash
# Build the Docker image
docker build -t eplustv-dev .

# Run with development volume mount
docker run -p 8000:8000 -v $(pwd):/app -v config_dir:/app/config eplustv-dev

# Run with permissions (if needed)
docker run -p 8000:8000 -v $(pwd):/app -v config_dir:/app/config -e PUID=$(id -u $USER) -e PGID=$(id -g $USER) eplustv-dev
```

### Testing and Debugging Individual Handlers

**⚠️ Important**: Running handler files directly with `npx ts-node services/handler-name.ts` will not work because handlers are class-based modules that don't execute code when imported.

#### Using Debug Scripts (Recommended)

The project includes debug scripts in the `debug/` directory for testing handlers:

```bash
# Test ESPN handler with various commands
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts help
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts initialize
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts getSchedule

# Quick prototyping (modify debug/quick-test.ts for your needs)
npx ts-node -r tsconfig-paths/register debug/quick-test.ts
```

#### Testing Specific Handler Methods

```bash
# Test a specific handler method with proper error handling
npx ts-node -r tsconfig-paths/register -e "
import {espnHandler} from './services/espn-handler';

async function test() {
  try {
    await espnHandler.initialize();
    await espnHandler.getSchedule();
    console.log('✅ Test completed successfully');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

test();
"
```

#### Code Quality Checks

```bash
# Check TypeScript compilation
npx tsc --noEmit

# Lint specific files
npx eslint services/espn-handler.ts --fix

# Format code
npx prettier --write services/

# Run pre-commit checks manually
npx lint-staged
```

#### Creating Debug Scripts for New Handlers

When working on a new handler, create a debug script following this pattern:

```typescript
// debug/test-new-handler.ts
import {newHandler} from '../services/new-handler';

async function testHandler() {
  try {
    await newHandler.initialize();
    console.log('Handler initialized successfully');
    
    // Test specific methods
    const result = await newHandler.someMethod();
    console.log('Method result:', result);
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

if (require.main === module) {
  testHandler();
}
```

## Reverse Engineering Streaming Services

When adding support for a new streaming provider (e.g., Peacock), use these tools to understand their API structure:

### Browser-Based Analysis

**Chrome/Firefox Developer Tools**
- **Network tab**: Monitor XHR/fetch requests to identify API endpoints for schedules, authentication, and stream URLs
- **Application tab**: Examine localStorage, sessionStorage, and cookies for tokens/credentials  
- **Console**: Test JavaScript expressions and inspect page objects
- **Sources tab**: Set breakpoints in JavaScript to understand authentication flows

**Browser Extensions**
- **Tampermonkey/Greasemonkey**: Inject JavaScript to log API calls and responses
- **ModHeader**: Modify request headers for testing different user agents or authentication
- **Cookie Editor**: Examine and modify authentication cookies

### HTTP Traffic Interception

**mitmproxy** (Recommended)
```bash
# Install and start mitmproxy
pip install mitmproxy
mitmproxy -p 8080

# Configure browser to use proxy, then browse streaming site
# Look for API calls in the mitmproxy interface
```

**Burp Suite Community Edition**
- Set up as HTTP proxy
- Monitor all traffic to/from streaming service
- Analyze authentication patterns and API structure

**Charles Proxy**
- Alternative HTTP proxy with GUI
- Good for SSL proxying mobile app traffic

### Command Line Analysis

```bash
# Test API endpoints discovered through browser analysis
curl -H "Authorization: Bearer TOKEN" "https://api.peacocktv.com/schedule"

# Parse JSON responses
curl "https://api.example.com/schedule" | jq '.events[] | {title, start_time, stream_url}'

# Analyze HLS streams
curl "https://example.com/playlist.m3u8" | head -20

# Extract video metadata
ffprobe -v quiet -print_format json -show_format "stream_url_here"

# Test with yt-dlp (already in dependencies)
yt-dlp --list-formats "https://peacocktv.com/watch/video-id"
```

### Specialized Tools

**Postman**
- Create collections for API endpoints
- Test authentication workflows
- Document API parameters and responses

**HLS Analysis**
```bash
# The project already includes hls-parser
npx ts-node -e "
import HLSParser from 'hls-parser';
import axios from 'axios';

axios.get('PLAYLIST_URL').then(response => {
  const playlist = HLSParser.parse(response.data);
  console.log(playlist);
});
"
```

**Browser Automation** (for complex auth flows)
```bash
# Install playwright for automation
npm install -D playwright

# Example script to automate login and capture network traffic
npx playwright codegen --target javascript peacocktv.com
```

## Adding a New Provider

**📖 For complete step-by-step provider implementation guide, see [ARCHITECTURE.md](./ARCHITECTURE.md#how-to-add-a-new-provider)**

**Quick Reference:**
1. **Handler**: Create `services/[provider]-handler.ts` with required methods
2. **UI Directory**: Create `services/providers/[provider]/` with route handlers and views  
3. **Integration**: Register in `services/providers/index.ts` and `services/launch-channel.ts`
4. **Debug Scripts**: Create `debug/[provider]-handler/` directory with testing scripts
5. **Testing**: Use debug scripts, then test UI integration

**Key Files to Create:**
- `services/[provider]-handler.ts` - Core handler logic
- `services/providers/[provider]/index.tsx` - Route handlers  
- `services/providers/[provider]/views/` - JSX components
- `debug/[provider]-handler/` - Testing scripts

## Debugging Common Issues

### Handler Initialization Problems

If a handler fails to initialize:

```bash
# Check if database files exist and are accessible
ls -la config/

# Test database connection
npx ts-node -r tsconfig-paths/register -e "
import {db} from './services/database';
db.providers.findOneAsync({name: 'espnplus'}).then(console.log);
"

# Check for missing dependencies
npm install
```

### Token/Authentication Issues

```bash
# Test token validity
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts refreshTokens

# Check stored credentials
npx ts-node -r tsconfig-paths/register -e "
import {db} from './services/database';
db.providers.findOneAsync({name: 'espnplus'}).then(result => {
  console.log('Provider config:', result);
});
"
```

### Network/API Issues

```bash
# Test network connectivity to provider APIs
curl -I "https://api.espn.com"

# Enable debug output (modify debug/quick-test.ts)
# Add console.log statements to trace API calls
```

### TypeScript/Import Issues

```bash
# Verify TypeScript compilation
npx tsc --noEmit

# Check path resolution
npx ts-node -r tsconfig-paths/register -e "console.log(require.resolve('./services/espn-handler'))"
```

## Testing ESPN Ultimate Subscription

**📖 For comprehensive ESPN Ultimate testing and authentication details, see [debug/README.md](./debug/README.md#testing-with-real-espn-authentication)**

ESPN Ultimate allows BAM token authentication for linear channels instead of traditional Adobe Pass authentication.

**Quick Test Commands:**
```bash
# Test Ultimate authentication flow
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-ultimate-linear.ts

# Test Ultimate functionality
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts testUltimate
```

**Setup Methods:**
- **Web UI**: Login at http://localhost:8000 (recommended)
- **Token Extraction**: See debug/README.md for browser extraction methods
- **Direct Injection**: Database token injection scripts in debug/README.md

## Interactive Debugging (Similar to Python's pdb)

### Method 1: VS Code Debugger (Recommended)

The project includes VS Code debug configurations. Set breakpoints in your code and press F5 to debug:

1. Open any TypeScript file in VS Code
2. Set breakpoints by clicking in the gutter  
3. Press F5 and select "Debug ESPN Handler" or "Debug Quick Test"
4. Use the debug console to inspect variables and execute code

### Method 2: Node.js Built-in Debugger

Add `debugger;` statements in your code, then run with inspect:

```bash
# Add debugger; statements in your code, then run:
node --inspect-brk -r ts-node/register -r tsconfig-paths/register debug/quick-test.ts

# Open Chrome and go to: chrome://inspect
# Click "Open dedicated DevTools for Node"
```

### Method 3: Interactive REPL Debugger

For a Python pdb-like experience:

```bash
# Start interactive debugger with loaded context
npx ts-node -r tsconfig-paths/register debug/interactive-debug.ts

# This gives you a REPL with espnHandler and db already loaded
debug> await espnHandler.getSchedule()
debug> await db.providers.findAsync({})
debug> .exit
```

### Method 4: Command Line Debugger (ndb)

Install and use ndb for the closest pdb experience:

```bash
# Install ndb globally
npm install -g ndb

# Run any script with ndb (opens Chrome DevTools)
ndb npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts initialize
```

## Analysis Strategy

1. **Start with the web interface**: Use browser dev tools to understand the basic API structure
2. **Identify authentication patterns**: Look for OAuth flows, JWT tokens, or session-based auth
3. **Map the data flow**: Schedule retrieval → content selection → stream URL generation
4. **Check mobile apps**: Sometimes mobile APIs are less obfuscated than web versions
5. **Document your findings**: Keep notes on API endpoints, authentication requirements, and data formats
6. **Test thoroughly**: Verify your implementation works across different content types and time periods

## Code Quality

Before submitting changes:

```bash
# Run pre-commit checks manually
npx lint-staged

# Check for TypeScript errors
npx tsc --noEmit

# Format all code
npx prettier --write .

# Lint and fix issues
npx eslint . --fix
```