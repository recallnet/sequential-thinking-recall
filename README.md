# Sequential Thinking MCP Server

An MCP server implementation that provides a tool for dynamic and reflective problem-solving through a structured thinking process which automatically writes sequential thinking logs to Recall associated with each thought session.

## Features

The Sequential Thinking MCP provides the following capabilities:

- **Step-by-Step Problem Solving**
  - Break down complex problems into manageable steps
  - Revise and refine thoughts as understanding deepens
  - Branch into alternative paths of reasoning
  - Adjust the total number of thoughts dynamically

- **Hypothesis Management**
  - Generate solution hypotheses
  - Verify hypotheses based on the chain of thought
  - Provide corrective analysis when needed

- **Recall Integration**
  - Store all sequential thinking sessions securely on-chain
  - Access complete thought histories
  - Retrieve specific thinking sessions
  - List all stored sessions

## Security ⚠️

> **IMPORTANT: PRIVATE KEY PROTECTION**

This MCP server requires a private key for Recall operations. To protect this sensitive information:

1. **NEVER share your private key or .env file contents**
2. **NEVER run commands that display your private key** (like `cat .env`)
3. **NEVER allow the LLM to execute shell commands directly** without your approval
4. If using a .env file, store it with restricted permissions: `chmod 600 .env`

### Multiple Layers of Protection

This server implements several layers of security to keep your private key safe:

#### 1. Private Key Isolation
- Your private key is only loaded during initialization
- After loading, the key is immediately removed from environment variables
- The actual key is never logged or transmitted to the LLM

#### 2. Log Protection
- Automatic redaction of any private key patterns in logs
- Console output is filtered to replace private keys with `[REDACTED]`
- Object sanitization that masks sensitive fields before display

#### 3. Access Prevention
- Secure environment variable handling
- Strict validation of required environment variables
- Console output sanitization to prevent leaking secrets

## Recall Integration

This MCP server includes integration with [Recall](https://recall.network), allowing you to store sequential thinking logs securely on-chain. All thinking steps for each query are automatically saved to your Recall bucket.

### Configuration

To use the Recall integration, you need to provide the following environment variables:

- `RECALL_PRIVATE_KEY` (required): Your Recall private key
- `RECALL_NETWORK` (optional): The network to connect to (testnet or mainnet, defaults to testnet)
- `RECALL_BUCKET_ALIAS` (optional): The alias for the bucket where logs will be stored (defaults to 'sequential-thinking-logs')
- `RECALL_LOG_PREFIX` (optional): The prefix for log files stored in the bucket (defaults to 'sequential-')

Each thought is stored individually with its metadata, and complete thinking sessions are stored when finished. This allows you to:
- Review complete reasoning chains
- Analyze thought processes
- Save valuable problem-solving approaches for future reference
- Build a knowledge base of reasoning patterns

## Environment Variable Precedence

The Sequential Thinking MCP server uses the following order of precedence for environment variables:

1. Environment variables provided directly from Cursor/Claude configuration
2. Environment variables from a .env file (if present and #1 is not available)
3. Default values for optional variables

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Choose one of these configuration methods:

   ### Method 1: Using environment variables in Cursor/Claude config (Recommended)
   The recommended approach is to provide environment variables directly in your Cursor or Claude Desktop configuration. This is more secure and eliminates the need for a .env file.
   
   - The server will automatically use these environment variables when provided through the configuration.
   - See the "Adding to Cursor" and "Adding to Claude Desktop" sections below for specific setup instructions.

   ### Method 2: Using a .env file (Fallback)
   If you prefer to use a .env file, or are running the server directly without Cursor/Claude, you can create one:
   
   1. Create a `.env` file with your private key:
      ```
      RECALL_PRIVATE_KEY=your_private_key_here
      RECALL_NETWORK=testnet
      RECALL_BUCKET_ALIAS=sequential-thinking-logs
      RECALL_LOG_PREFIX=sequential-
      ```
   
   2. Secure your .env file:
      ```bash
      chmod 600 .env
      ```
   
   Note: The private key can be provided with or without the "0x" prefix - both formats work.

## Tools

The server exposes the following MCP tools:

| Tool Name | Description | Parameters |
|-----------|-------------|------------|
| `sequentialthinking` | Process step-by-step thinking and store in Recall | `thought`: String, `nextThoughtNeeded`: Boolean, `thoughtNumber`: Integer, `totalThoughts`: Integer, plus optional parameters |
| `recallstatus` | Get the status of the Recall integration | `check`: Boolean |
| `listsessions` | List all sequential thinking sessions | `includePortalLinks?`: Boolean |
| `getsession` | Get a specific thinking session | `key`: String |

### sequentialthinking

Facilitates a detailed, step-by-step thinking process for problem-solving and analysis.

**Inputs:**
- `thought` (string): The current thinking step
- `nextThoughtNeeded` (boolean): Whether another thought step is needed
- `thoughtNumber` (integer): Current thought number
- `totalThoughts` (integer): Estimated total thoughts needed
- `isRevision` (boolean, optional): Whether this revises previous thinking
- `revisesThought` (integer, optional): Which thought is being reconsidered
- `branchFromThought` (integer, optional): Branching point thought number
- `branchId` (string, optional): Branch identifier
- `needsMoreThoughts` (boolean, optional): If more thoughts are needed

**Output:**
When the final thought is submitted (`nextThoughtNeeded` = false), the tool returns:
- `recallInfo` with:
  - `txHash`: The transaction hash on the Recall network
  - `success`: Whether storage was successful
  - `key`: The session file name
  - `viewUrl`: A direct link to view the session in the Recall portal

### recallstatus

Get the status of the Recall integration.

**Inputs:**
- `check` (boolean): Set to true to check the status

**Output:**
- Information about the Recall integration including initialization status, bucket address, bucket alias, and log prefix

### listsessions

List all sequential thinking session objects stored in your Recall bucket.

**Inputs:**
- `includePortalLinks` (boolean, optional): Whether to include portal links for each session

**Output:**
- A list of all stored session files with their metadata and optional portal links

### getsession

Retrieve the contents of a specific sequential thinking session file.

**Inputs:**
- `key` (string): The key/filename of the session to retrieve

**Output:**
- The complete contents of the requested session file including all thoughts and metadata
- A portal link to view the session in the Recall portal

## Usage

The Sequential Thinking tool is designed for:
- Breaking down complex problems into steps
- Planning and design with room for revision
- Analysis that might need course correction
- Problems where the full scope might not be clear initially
- Tasks that need to maintain context over multiple steps
- Situations where irrelevant information needs to be filtered out

## Building

```bash
npm run build
npm run start
```

### Development Mode

```bash
npm run dev
```

### Important Note for Development

When developing the MCP server, use `console.error()` instead of `console.log()` for all debugging and logging. The Claude Desktop app communicates with the server via stdout, so any `console.log()` statements will interfere with this communication and cause JSON parsing errors.

## Adding to Cursor

To add this MCP server to Cursor:

1. Build the project first with `npm run build`
2. In Cursor, go to Settings > MCP Servers
3. Click "Add Server"
4. Configure the server with the following settings:
   - **Name**: `Sequential Thinking MCP` (or any name you prefer)
   - **Type**: `command`
   - **Command**: `node`
   - **Arguments**: `/path/to/sequential-thinking-recall/dist/index.js` (replace with your actual path)
   - **Environment Variables**:
     - `RECALL_PRIVATE_KEY`: Your private key (with or without "0x" prefix)
     - `RECALL_NETWORK`: `testnet` (or `mainnet` if needed)
     - `RECALL_BUCKET_ALIAS`: `sequential-thinking-logs`
     - `RECALL_LOG_PREFIX`: `sequential-`
5. Click "Save"

### Using Environment Variables in Cursor Configuration

For more security, you can configure Cursor via the `.cursor/mcp.json` file in your home directory:

```json
{
  "mcpServers": {
    "sequential-thinking-mcp": {
      "command": "node",
      "args": [
        "/Users/yourusername/sequential-thinking-recall/dist/index.js"
      ],
      "env": {
        "RECALL_PRIVATE_KEY": "your-private-key-here",
        "RECALL_NETWORK": "testnet",
        "RECALL_BUCKET_ALIAS": "sequential-thinking-logs",
        "RECALL_LOG_PREFIX": "sequential-"
      }
    }
  }
}
```

This approach eliminates the need for a .env file.

## Adding to Claude Desktop

To add this MCP server to Claude Desktop:

1. Build the project first with `npm run build`
2. Locate your Claude Desktop configuration file at:
   - On macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - On Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - On Linux: `~/.config/Claude/claude_desktop_config.json`

3. Create or edit the `claude_desktop_config.json` file with the following content:
   ```json
   {
     "mcpServers": {
       "sequential-thinking-mcp": {
         "command": "node",
         "args": [
           "/path/to/sequential-thinking-recall/dist/index.js"
         ],
         "env": {
           "RECALL_PRIVATE_KEY": "your-private-key-here",
           "RECALL_NETWORK": "testnet",
           "RECALL_BUCKET_ALIAS": "sequential-thinking-logs",
           "RECALL_LOG_PREFIX": "sequential-"
         }
       }
     }
   }
   ```

4. Replace `/path/to/sequential-thinking-recall/dist/index.js` with the full path to your compiled server file
   - Example: `/Users/username/sequential-thinking-recall/dist/index.js`

5. For the `RECALL_PRIVATE_KEY`, you can provide it with or without the "0x" prefix - both formats work

6. Save the configuration file and restart Claude Desktop

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.
