#!/usr/bin/env node

/**
 * Debug script for testing ESPN handler functionality
 * Usage: npx ts-node -r tsconfig-paths/register debug/test-espn-handler.ts [command]
 */

import {espnHandler} from '../../services/espn-handler';

interface DebugCommands {
  [key: string]: () => Promise<void>;
}

const commands: DebugCommands = {
  async getSchedule() {
    console.log('📅 Getting ESPN schedule...');
    await espnHandler.initialize();
    await espnHandler.getSchedule();
    console.log('✅ Schedule retrieval completed');
  },

  async help() {
    console.log(`
🔧 ESPN Handler Debug Commands:

  initialize         - Initialize the ESPN handler and database connections
  getSchedule       - Fetch and process ESPN schedule data
  refreshTokens     - Refresh authentication tokens
  refreshInMarketTeams - Update in-market teams based on location
  testIspAccess     - Test ISP-based ESPN3 access
  testUltimate      - Test ESPN Ultimate subscription functionality
  help              - Show this help message

Examples:
  npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts initialize
  npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts getSchedule
  npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts testUltimate
    `);
  },

  async initialize() {
    console.log('🚀 Initializing ESPN handler...');
    await espnHandler.initialize();
    console.log('✅ ESPN handler initialized successfully');
  },

  async refreshInMarketTeams() {
    console.log('🏠 Refreshing in-market teams...');
    await espnHandler.initialize();
    const result = await espnHandler.refreshInMarketTeams();
    console.log('✅ In-market teams refresh completed:', result);
  },

  async refreshTokens() {
    console.log('🔄 Refreshing ESPN tokens...');
    await espnHandler.initialize();
    await espnHandler.refreshTokens();
    console.log('✅ Token refresh completed');
  },

  async testIspAccess() {
    console.log('🌐 Testing ISP access...');
    await espnHandler.initialize();
    const hasAccess = await espnHandler.ispAccess();
    console.log('✅ ISP access test completed:', hasAccess ? 'Access available' : 'No access');
  },

  async testUltimate() {
    console.log('🧪 Testing ESPN Ultimate subscription functionality...');
    await espnHandler.initialize();

    // Import the database and interfaces
    const {db} = await import('../../services/database');

    // Test the ultimate subscription functionality
    const {enabled: espnPlusEnabled, meta: plusMeta} = await db.providers.findOneAsync({name: 'espnplus'});
    const isUltimateEnabled = (plusMeta?.ultimate_subscription ? true : false) && espnPlusEnabled;

    console.log('✅ ESPN+ enabled:', espnPlusEnabled);
    console.log('✅ Ultimate subscription:', plusMeta?.ultimate_subscription);
    console.log('✅ Ultimate functionality:', isUltimateEnabled);

    console.log('\n📚 To toggle Ultimate subscription:');
    console.log('1. Go to http://localhost:8000');
    console.log('2. Find the ESPN+ section');
    console.log('3. Toggle the "ESPN Ultimate?" checkbox');
  },
};

async function main() {
  const command = process.argv[2] || 'help';

  if (!commands[command]) {
    console.error(`❌ Unknown command: ${command}`);
    await commands.help();
    process.exit(1);
  }

  try {
    await commands[command]();
  } catch (error) {
    console.error(`❌ Error executing ${command}:`, error.message);
    process.exit(1);
  }
}

// Run the main function if this script is executed directly
if (require.main === module) {
  main();
}
