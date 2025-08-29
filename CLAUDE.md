# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Start server**: `npm start` - Runs the TypeScript server using ts-node with path registration
- **Lint code**: `npx eslint <files>` - ESLint with TypeScript support and custom sorting rules
- **Format code**: `npx prettier --write <files>` - Code formatting
- **Pre-commit**: `npx lint-staged` - Runs prettier and eslint on staged files (configured via husky)
- **Debug handlers**: Use scripts in `debug/` directory for testing individual providers
- **Test with real auth**: `npx ts-node -r tsconfig-paths/register debug/espn-handler/test-with-real-tokens.ts`

## Architecture Overview

**📖 For comprehensive architectural understanding, see [ARCHITECTURE.md](./ARCHITECTURE.md)**

EPlusTV is a Node.js application that aggregates sports streaming content from various providers into virtual linear TV channels. The application generates M3U playlists and XMLTV schedules for media center integration.

**Key Concepts:**
- **HLS Proxy Model**: Server acts as proxy between clients and providers
- **Multi-Token Authentication**: Complex authentication with BAM + Adobe Pass tokens  
- **Virtual Channel Scheduling**: Dynamic assignment of events to linear channels
- **Provider Handler Pattern**: Modular provider implementations with standardized interfaces

### Core Components

**Main Application** (`index.tsx`):
- Hono-based HTTP server with JSX templating  
- Serves M3U playlists (`/channels.m3u`, `/linear-channels.m3u`) and XMLTV schedules (`/xmltv.xml`, `/linear-xmltv.xml`)
- HLS streaming proxy for channel content (`/channels/:id.m3u8`, `/chunklist/:id/:chunklistid.m3u8`)
- Web UI for provider configuration and system management

**Service Layer** (`services/`):
- Individual handler files for each sports provider (ESPN, MLB, NFL, FOX, etc.)
- Core services: `build-schedule.ts`, `generate-m3u.ts`, `generate-xmltv.ts`, `launch-channel.ts`
- Database abstraction via NeDB (`database.ts`, `misc-db-service.ts`)
- Shared utilities: `shared-helpers.ts`, `shared-interfaces.ts`

**Provider Architecture** (`services/providers/`):
- Each provider has its own directory with:
  - `index.tsx` - Hono route handlers for authentication/configuration
  - `views/` - JSX components for provider-specific UI (Login, CardBody, etc.)
- Provider registration in `services/providers/index.ts`
- Handler classes in `services/` follow naming pattern `[provider]-handler.ts`

### Key Architectural Patterns

- **Handler Pattern**: Each provider has a dedicated handler class for schedule fetching and stream management
- **JSX Components**: UI built with JSX components using Hono's JSX runtime
- **HLS Streaming**: Server acts as proxy/aggregator for HLS streams from various providers
- **Schedule Building**: Centralized schedule building that aggregates events from all enabled providers
- **Database**: NeDB for lightweight data persistence (channels, schedules, configuration)

### Authentication Architecture

**📖 See [ARCHITECTURE.md](./ARCHITECTURE.md#authentication-architecture-deep-dive) for detailed authentication patterns**

**Multi-Token System**: Providers use complex authentication with multiple token types:

**ESPN Example** - Dual authentication system:
- **BAM Tokens**: Disney+/ESPN+ authentication (on-demand + ESPN Ultimate linear)
- **Adobe Pass Tokens**: Traditional TV provider authentication (standard linear channels)  
- **ESPN Ultimate**: Premium feature allowing BAM authentication for linear channels

**Key Patterns**:
- **Dual Persistence**: Database + JSON files for reliability
- **JWT Validation**: Token expiration checking with automatic refresh
- **Graceful Fallback**: Multiple authentication paths with error handling
- **Dynamic Authentication**: Runtime choice between authentication methods based on content type

### TypeScript Configuration

- Uses `ts-node` for development with `tsconfig-paths` for path mapping
- Path alias: `@/*` maps to project root
- JSX configured for `hono/jsx` import source
- Target ES6 with CommonJS modules

### Docker Support

- Alpine Linux base with Node.js, npm, and yt-dlp
- Entry point script handles user/group permissions
- Mounts `/app/config` for persistent data storage

## Database Schema

**📖 See [ARCHITECTURE.md](./ARCHITECTURE.md#database-schema-and-data-flow) for complete schema details**

**NeDB Collections**:
- **`providers`**: Provider authentication tokens and configuration metadata
- **`entries`**: Raw event data from provider APIs
- **`schedule`**: Virtual channel assignments and scheduling data

**Key Provider Structure** (`providers` collection):
- `name`: Provider identifier (e.g., 'espnplus', 'espn')  
- `enabled`: Runtime toggle state
- `tokens`: Provider-specific authentication data
- `meta`: Configuration options (Ultimate subscription, PPV, location, etc.)

## Handler Implementation Patterns

**📖 See [ARCHITECTURE.md](./ARCHITECTURE.md#provider-handler-patterns) for detailed implementation patterns**

**Standard Handler Lifecycle**:
1. **`initialize()`** - Load tokens and configuration
2. **`refreshTokens()`** - JWT validation and automatic refresh  
3. **`getSchedule()`** - Fetch EPG data from provider APIs
4. **`getEventData()`** - Get HLS manifest URLs for streaming
5. **`save()`** - Persist authentication tokens

**Critical Implementation Requirements**:
- **Dual Token Persistence**: Database + JSON files for reliability
- **Graceful Authentication**: Fallback paths when primary auth fails
- **Token Validation**: JWT expiration checking with automatic refresh
- **Rate Limiting**: Throttled API calls to avoid provider blocking

## Provider UI Pattern

**Route Structure** (`services/providers/[provider]/index.tsx`):
```typescript
const provider = new Hono<{Bindings: Env}>();

// Toggle endpoints for UI controls
provider.put('/toggle-feature', async c => {
  const body = await c.req.parseBody();
  const enabled = body['feature-enabled'] === 'on';
  
  await db.providers.updateAsync(
    {name: 'provider'}, 
    {$set: {'meta.feature': enabled}}
  );
  
  // Return updated component
  return c.html(<ComponentWithNewState />);
});

export {provider};
```

**View Components** (`services/providers/[provider]/views/`):
- `index.tsx` - Main provider card
- `Login.tsx` - Authentication interface  
- `CardBody.tsx` - Configuration controls

## Debugging and Testing

**📖 For comprehensive debugging guide, see [debug/README.md](./debug/README.md)**

**Debug Scripts** (`debug/` directory):
- Never run handler files directly with `npx ts-node services/handler.ts` 
- Always use debug scripts: `npx ts-node -r tsconfig-paths/register debug/test-handler.ts`
- Handler files are class modules that don't execute when imported

**Authentication Testing**:
- Use `debug/espn-handler/test-with-real-tokens.ts` for real credential testing
- See `debug/README.md` for token extraction from browsers and injection methods
- Test both authentication paths (e.g., BAM vs Adobe Pass for ESPN)

**Common Debugging Commands**:
```bash
# Test specific handler
npx ts-node -r tsconfig-paths/register debug/espn-handler/test-espn-handler.ts initialize

# Interactive debugging
npx ts-node -r tsconfig-paths/register debug/interactive-debug.ts

# Check database state
npx ts-node -r tsconfig-paths/register -e "
import {db} from './services/database';
db.providers.findAsync({}).then(console.log);
"
```

## Development Guidelines

**Adding New Providers**:

**📖 See [ARCHITECTURE.md](./ARCHITECTURE.md#how-to-add-a-new-provider) for complete step-by-step guide**

**Quick Reference**:
1. **Handler**: Create `services/[provider]-handler.ts` with required methods
2. **UI Directory**: Create `services/providers/[provider]/` with route handlers and views  
3. **Integration**: Register in `services/providers/index.ts` and `services/launch-channel.ts`
4. **Debug Scripts**: Create `debug/[provider]-handler/` directory with testing scripts
5. **Authentication**: Implement dual persistence, token validation, graceful fallback

**Key Implementation Patterns**:
- **Study ESPN Handler**: Use `services/espn-handler.ts` as complex authentication example
- **Follow UI Patterns**: Use HTMX for dynamic updates, provider meta for configuration
- **Test Thoroughly**: Mock data first, then real authentication with debug scripts
- **Graceful Failures**: Handle authentication failures without breaking the system