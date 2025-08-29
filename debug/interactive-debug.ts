#!/usr/bin/env node

/**
 * Interactive debugging REPL - similar to Python's breakpoint()
 * Usage: npx ts-node -r tsconfig-paths/register debug/interactive-debug.ts
 */

import * as repl from 'repl';
import {espnHandler} from '../services/espn-handler';
import {db} from '../services/database';

async function startInteractiveDebugger() {
  console.log('🔍 Starting interactive debugger...');
  console.log('📝 Available variables: espnHandler, db');
  console.log('📝 Try: await espnHandler.initialize()');
  console.log('📝 Or: await db.providers.findOneAsync({name: "espnplus"})');
  console.log('📝 Type .exit to quit\n');

  // Initialize context
  await espnHandler.initialize();

  const replServer = repl.start({
    ignoreUndefined: true,
    prompt: 'debug> ',
    useColors: true,
  });

  // Add variables to REPL context
  replServer.context.espnHandler = espnHandler;
  replServer.context.db = db;

  // Add helper functions
  replServer.context.help = () => {
    console.log(`
Available objects:
  - espnHandler: ESPN handler instance
  - db: Database instance
  
Common commands:
  - await espnHandler.getSchedule()
  - await espnHandler.refreshTokens()
  - await db.providers.findAsync({})
  - .exit (to quit)
    `);
  };

  // Handle async/await in REPL
  replServer.setupHistory('.repl_history', err => {
    if (err) console.log('Could not set up REPL history');
  });
}

if (require.main === module) {
  startInteractiveDebugger().catch(console.error);
}
