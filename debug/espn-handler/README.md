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

For detailed information about token extraction and setup, see the main `debug/README.md` file.