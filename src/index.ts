#!/usr/bin/env node

// Add debug logging to help diagnose startup issues
console.error("Starting Sequential Thinking MCP Server...");
console.error(`Environment variables present: ${Object.keys(process.env).filter(k => !k.includes('KEY') && !k.includes('SECRET')).join(', ')}`);

// Import configuration first to ensure environment variables are loaded
import { RECALL_BUCKET_ALIAS, RECALL_LOG_PREFIX, logConfigStatus } from './config.js';

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
// Fixed chalk import for ESM
import chalk from 'chalk';
// Import our RecallIntegration
import { recallIntegration } from './recall-integration.js';

// Log configuration status
logConfigStatus();

interface ThoughtData {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
  nextThoughtNeeded: boolean;
}

class SequentialThinkingServer {
  private thoughtHistory: ThoughtData[] = [];
  private branches: Record<string, ThoughtData[]> = {};
  private currentQuery?: string;
  private currentSessionId: string = '';

  constructor() {
    // Initialize Recall integration
    this.initializeRecall();
    // Generate initial session ID
    this.generateNewSessionId();
  }

  private generateNewSessionId(): string {
    this.currentSessionId = `session-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    console.error(chalk.blue(`🔄 Created new session ID: ${this.currentSessionId}`));
    return this.currentSessionId;
  }

  private clearSession(): void {
    console.error(chalk.blue(`🧹 Clearing session data for ${this.currentSessionId}`));
    this.thoughtHistory = [];
    this.branches = {};
    this.currentQuery = undefined;
    this.generateNewSessionId();
  }

  private async initializeRecall(): Promise<void> {
    try {
      await recallIntegration.initializeBucket();
      console.error(chalk.green('🔄 Recall integration initialized for sequential thinking logs'));
    } catch (error: any) {
      console.error(chalk.yellow(`⚠️ Recall initialization failed: ${error.message}`));
      console.error(chalk.yellow('Sequential thinking will still work but logs won\'t be stored in Recall'));
    }
  }

  private validateThoughtData(input: unknown): ThoughtData {
    const data = input as Record<string, unknown>;

    if (!data.thought || typeof data.thought !== 'string') {
      throw new Error('Invalid thought: must be a string');
    }
    if (!data.thoughtNumber || typeof data.thoughtNumber !== 'number') {
      throw new Error('Invalid thoughtNumber: must be a number');
    }
    if (!data.totalThoughts || typeof data.totalThoughts !== 'number') {
      throw new Error('Invalid totalThoughts: must be a number');
    }
    if (typeof data.nextThoughtNeeded !== 'boolean') {
      throw new Error('Invalid nextThoughtNeeded: must be a boolean');
    }

    return {
      thought: data.thought,
      thoughtNumber: data.thoughtNumber,
      totalThoughts: data.totalThoughts,
      nextThoughtNeeded: data.nextThoughtNeeded,
      isRevision: data.isRevision as boolean | undefined,
      revisesThought: data.revisesThought as number | undefined,
      branchFromThought: data.branchFromThought as number | undefined,
      branchId: data.branchId as string | undefined,
      needsMoreThoughts: data.needsMoreThoughts as boolean | undefined,
    };
  }

  private formatThought(thoughtData: ThoughtData): string {
    const { thoughtNumber, totalThoughts, thought, isRevision, revisesThought, branchFromThought, branchId } = thoughtData;

    let prefix = '';
    let context = '';

    if (isRevision) {
      prefix = chalk.yellow('🔄 Revision');
      context = ` (revising thought ${revisesThought})`;
    } else if (branchFromThought) {
      prefix = chalk.green('🌿 Branch');
      context = ` (from thought ${branchFromThought}, ID: ${branchId})`;
    } else {
      prefix = chalk.blue('💭 Thought');
      context = '';
    }

    const header = `${prefix} ${thoughtNumber}/${totalThoughts}${context}`;
    const border = '─'.repeat(Math.max(header.length, thought.length) + 4);

    return `
┌${border}┐
│ ${header} │
├${border}┤
│ ${thought.padEnd(border.length - 2)} │
└${border}┘`;
  }

  private async storeSessionToRecall(): Promise<{ txHash?: string, success: boolean, key: string } | undefined> {
    if (this.thoughtHistory.length === 0) return undefined;
    
    try {
      console.error(chalk.blue(`🔍 Debug: Attempting to store session ${this.currentSessionId} with ${this.thoughtHistory.length} thoughts to Recall`));
      const status = await recallIntegration.getStatusInfo();
      console.error(chalk.blue(`🔍 Debug: Recall status before storing session: ${JSON.stringify(status, null, 2)}`));
      
      // Store the session with all accumulated thoughts
      console.error(chalk.blue(`🔍 Debug: Storing complete thought history with ${this.thoughtHistory.length} thoughts`));
      
      // Create a deep clone of the thoughts to prevent any reference issues
      const thoughtsToStore = this.thoughtHistory.map(thought => ({
        ...thought,
        thought: thought.thought,  // Explicitly copy the thought text
        thoughtNumber: thought.thoughtNumber,
        totalThoughts: thought.totalThoughts,
        nextThoughtNeeded: thought.nextThoughtNeeded,
        // Include other properties if present
        isRevision: thought.isRevision,
        revisesThought: thought.revisesThought,
        branchFromThought: thought.branchFromThought,
        branchId: thought.branchId,
        needsMoreThoughts: thought.needsMoreThoughts,
        // Add the session ID for tracking
        sessionId: this.currentSessionId
      }));
      
      // Log each thought for debugging
      thoughtsToStore.forEach((thought, index) => {
        console.error(chalk.blue(`🔍 Debug: Thought ${index + 1}: ${JSON.stringify({
          thought: thought.thought.substring(0, 50) + (thought.thought.length > 50 ? '...' : ''),
          thoughtNumber: thought.thoughtNumber,
          totalThoughts: thought.totalThoughts,
          nextThoughtNeeded: thought.nextThoughtNeeded,
          sessionId: thought.sessionId
        })}`));
      });
      
      const storeResult = await recallIntegration.storeSession(
        thoughtsToStore,
        { 
          query: this.currentQuery || 'No query provided',
          sessionId: this.currentSessionId
        }
      );
      
      if (storeResult?.success) {
        console.error(chalk.green(`✅ Debug: Successfully stored session with result: ${JSON.stringify(storeResult, null, 2)}`));
      } else {
        console.error(chalk.yellow(`⚠️ Debug: Store session returned unsuccessful result`));
      }
      
      return storeResult;
    } catch (error: any) {
      console.error(chalk.red(`❌ Error handling session storage: ${error.message}`));
      console.error(chalk.red(`Stack trace: ${error.stack}`));
      return undefined;
    }
  }

  public async processThought(input: unknown, query?: string): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    try {
      const validatedInput = this.validateThoughtData(input);

      // Save the query if provided and not already set
      if (query && !this.currentQuery) {
        this.currentQuery = query;
        console.error(chalk.blue(`🔍 Set query: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`));
      }

      if (validatedInput.thoughtNumber > validatedInput.totalThoughts) {
        validatedInput.totalThoughts = validatedInput.thoughtNumber;
      }

      // Add to our local thought history
      this.thoughtHistory.push(validatedInput);
      console.error(chalk.blue(`📝 Added thought #${validatedInput.thoughtNumber} to memory (now have ${this.thoughtHistory.length} thoughts)`));

      if (validatedInput.branchFromThought && validatedInput.branchId) {
        if (!this.branches[validatedInput.branchId]) {
          this.branches[validatedInput.branchId] = [];
        }
        this.branches[validatedInput.branchId].push(validatedInput);
      }

      const formattedThought = this.formatThought(validatedInput);
      console.error(formattedThought);

      // If this is the last thought (nextThoughtNeeded is false), store the complete session
      let sessionInfo;
      if (!validatedInput.nextThoughtNeeded) {
        console.error(chalk.blue(`🔍 Debug: Final thought received (${validatedInput.thoughtNumber}/${validatedInput.totalThoughts}), storing complete session to Recall`));
        
        // Log the number of thoughts we have in memory before storage
        console.error(chalk.blue(`📊 Debug: Thought history contains ${this.thoughtHistory.length} thoughts before storage`));
        
        // Store all thoughts at once
        sessionInfo = await this.storeSessionToRecall();
        
        // Direct console output for debugging Recall transactions
        if (sessionInfo) {
          // Get the bucketAddress for the portal URL
          const recallStatus = await recallIntegration.getStatusInfo();
          const portalUrl = `https://portal.recall.network/buckets/${recallStatus.bucketAddress}?path=${sessionInfo.key}`;
          
          console.error(chalk.magenta(`
╔═════════════════════════════════════════════════════════
║ 📊 RECALL SESSION QUEUED
║ Key: ${sessionInfo.key}
║ Success: ${sessionInfo.success ? '✅' : '❌'}
║ Transaction: ${sessionInfo.txHash || 'Pending'}
║ 
║ 🔗 View in Recall Portal:
║ ${portalUrl}
╚═════════════════════════════════════════════════════════
`));
          
          // After successful storage, clear the session data to prepare for a new sequence
          if (sessionInfo.success) {
            // Clear the session data
            this.clearSession();
            console.error(chalk.green(`✅ Session data cleared, ready for new thoughts`));
          }
        } else {
          console.error(chalk.yellow(`⚠️ Warning: No session info returned from storeSessionToRecall!`));
        }
      } else {
        console.error(chalk.blue(`🔍 Debug: Non-final thought #${validatedInput.thoughtNumber} added to memory, waiting for more thoughts`));
      }

      // Build the response with recall information if available
      const response = {
        thoughtNumber: validatedInput.thoughtNumber,
        totalThoughts: validatedInput.totalThoughts,
        nextThoughtNeeded: validatedInput.nextThoughtNeeded,
        branches: Object.keys(this.branches),
        thoughtHistoryLength: this.thoughtHistory.length,
        // Include the complete thought history data
        thoughtHistory: this.thoughtHistory
      };

      // Add a separate field specifically for Claude to see the Recall info
      const recallStatus = await recallIntegration.getStatusInfo();
      const responseWithRecall = {
        ...response,
        recallInfo: sessionInfo ? {
          txHash: sessionInfo?.txHash,
          success: sessionInfo?.success,
          key: sessionInfo?.key,
          operation: 'session',
          stored: true,
          pendingTransactionCount: recallIntegration.isInitialized() ? 
            (await recallIntegration.getStatusInfo()).pendingThoughts : 0,
          // Add the URL for viewing the session in the Recall portal
          viewUrl: `https://portal.recall.network/buckets/${recallStatus.bucketAddress}?path=${sessionInfo.key}`
        } : {
          stored: false,
          reason: validatedInput.nextThoughtNeeded ? 
            "Session not complete yet - storing in memory only" : 
            "Recall storage pending or unavailable",
          thoughtsInMemory: this.thoughtHistory.length,
          isSessionComplete: !validatedInput.nextThoughtNeeded
        }
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify(responseWithRecall, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            status: 'failed'
          }, null, 2)
        }],
        isError: true
      };
    }
  }
}

const SEQUENTIAL_THINKING_TOOL: Tool = {
  name: "sequentialthinking",
  description: `A detailed tool for dynamic and reflective problem-solving through thoughts.
This tool helps analyze problems through a flexible thinking process that can adapt and evolve.
Each thought can build on, question, or revise previous insights as understanding deepens.

When to use this tool:
- Breaking down complex problems into steps
- Planning and design with room for revision
- Analysis that might need course correction
- Problems where the full scope might not be clear initially
- Problems that require a multi-step solution
- Tasks that need to maintain context over multiple steps
- Situations where irrelevant information needs to be filtered out

Key features:
- You can adjust total_thoughts up or down as you progress
- You can question or revise previous thoughts
- You can add more thoughts even after reaching what seemed like the end
- You can express uncertainty and explore alternative approaches
- Not every thought needs to build linearly - you can branch or backtrack
- Generates a solution hypothesis
- Verifies the hypothesis based on the Chain of Thought steps
- Repeats the process until satisfied
- Provides a correct answer

Parameters explained:
- thought: Your current thinking step, which can include:
* Regular analytical steps
* Revisions of previous thoughts
* Questions about previous decisions
* Realizations about needing more analysis
* Changes in approach
* Hypothesis generation
* Hypothesis verification
- next_thought_needed: True if you need more thinking, even if at what seemed like the end
- thought_number: Current number in sequence (can go beyond initial total if needed)
- total_thoughts: Current estimate of thoughts needed (can be adjusted up/down)
- is_revision: A boolean indicating if this thought revises previous thinking
- revises_thought: If is_revision is true, which thought number is being reconsidered
- branch_from_thought: If branching, which thought number is the branching point
- branch_id: Identifier for the current branch (if any)
- needs_more_thoughts: If reaching end but realizing more thoughts needed

You should:
1. Start with an initial estimate of needed thoughts, but be ready to adjust
2. Feel free to question or revise previous thoughts
3. Don't hesitate to add more thoughts if needed, even at the "end"
4. Express uncertainty when present
5. Mark thoughts that revise previous thinking or branch into new paths
6. Ignore information that is irrelevant to the current step
7. Generate a solution hypothesis when appropriate
8. Verify the hypothesis based on the Chain of Thought steps
9. Repeat the process until satisfied with the solution
10. Provide a single, ideally correct answer as the final output
11. Only set next_thought_needed to false when truly done and a satisfactory answer is reached

IMPORTANT: When providing your final answer (setting next_thought_needed to false), the system will store your complete thought sequence to Recall. After storage, ALWAYS inform the user where they can find their thought sequence by including:
- The transaction hash (from recallInfo.txHash)
- The session key/filename (from recallInfo.key)
- A direct link to view the session in the Recall portal (from recallInfo.viewUrl)

Format this information clearly at the end of your response, for example:

"Your thought sequence has been stored to Recall:
Transaction: [txHash]
Session file: [key] 
View in Recall Portal: [viewUrl]"`,
  inputSchema: {
    type: "object",
    properties: {
      thought: {
        type: "string",
        description: "Your current thinking step"
      },
      nextThoughtNeeded: {
        type: "boolean",
        description: "Whether another thought step is needed"
      },
      thoughtNumber: {
        type: "integer",
        description: "Current thought number",
        minimum: 1
      },
      totalThoughts: {
        type: "integer",
        description: "Estimated total thoughts needed",
        minimum: 1
      },
      isRevision: {
        type: "boolean",
        description: "Whether this revises previous thinking"
      },
      revisesThought: {
        type: "integer",
        description: "Which thought is being reconsidered",
        minimum: 1
      },
      branchFromThought: {
        type: "integer",
        description: "Branching point thought number",
        minimum: 1
      },
      branchId: {
        type: "string",
        description: "Branch identifier"
      },
      needsMoreThoughts: {
        type: "boolean",
        description: "If more thoughts are needed"
      }
    },
    required: ["thought", "nextThoughtNeeded", "thoughtNumber", "totalThoughts"]
  }
};

// Add a new tool for checking the Recall status
const RECALL_STATUS_TOOL: Tool = {
  name: "recallstatus",
  description: "Get the status of the Recall integration for storing sequential thinking logs",
  inputSchema: {
    type: "object",
    properties: {
      check: {
        type: "boolean",
        description: "Set to true to check the status"
      }
    },
    required: ["check"]
  }
};

// Add a new tool for listing all session objects
const LIST_SESSIONS_TOOL: Tool = {
  name: "listsessions",
  description: "List all sequential thinking session objects stored in Recall",
  inputSchema: {
    type: "object",
    properties: {
      includePortalLinks: {
        type: "boolean",
        description: "Whether to include portal links for each session"
      }
    },
    required: []
  }
};

// Add a new tool for retrieving a specific session file
const GET_SESSION_TOOL: Tool = {
  name: "getsession",
  description: "Retrieve the contents of a specific sequential thinking session file",
  inputSchema: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "The key/filename of the session to retrieve"
      }
    },
    required: ["key"]
  }
};

const server = new Server(
  {
    name: "sequential-thinking-server",
    version: "0.2.0",
  },
  {
    capabilities: {
      tools: {},    // We support tools
      resources: {}, // We support resources (even if we just return empty arrays)
      prompts: {}    // We support prompts (even if we just return empty arrays)
    },
  }
);

const thinkingServer = new SequentialThinkingServer();

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [SEQUENTIAL_THINKING_TOOL, RECALL_STATUS_TOOL, LIST_SESSIONS_TOOL, GET_SESSION_TOOL],
}));

// Add empty handlers for resources and prompts
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [],
}));

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (request.params.name === "sequentialthinking") {
      // Try to extract the query from the arguments if possible
      // Many LLM clients will include "metadata" in the arguments with query information
      const args = request.params.arguments as Record<string, any>;
      const query = args?._metadata?.query || args?._meta?.query || undefined;
      
      // Add debug output for tracking requests
      console.error(chalk.blue(`🔄 Received sequential thinking request with thought #${args.thoughtNumber}/${args.totalThoughts}`));
      console.error(chalk.blue(`🔄 Thought content: ${args.thought.substring(0, 100)}${args.thought.length > 100 ? '...' : ''}`));
      
      // Check Recall status before processing
      try {
        const status = await recallIntegration.getStatusInfo();
        console.error(chalk.blue(`🔍 Current Recall status: ${JSON.stringify(status, null, 2)}`));
      } catch (error: any) {
        console.error(chalk.yellow(`⚠️ Error checking Recall status: ${error.message}`));
      }
      
      return await thinkingServer.processThought(request.params.arguments, query);
    } else if (request.params.name === "recallstatus") {
      try {
        // Check if Recall is initialized
        console.error(chalk.blue('🔍 Checking Recall status...'));
        
        // Force initialize if needed
        if (!recallIntegration.isInitialized()) {
          console.error(chalk.yellow('⚠️ Recall not initialized, reinitializing...'));
          await recallIntegration.initializeBucket();
        }
        
        const bucketInfo = await recallIntegration.getStatusInfo();
        console.error(chalk.green(`✅ Recall status check succeeded: ${JSON.stringify(bucketInfo, null, 2)}`));
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              recallStatus: {
                initialized: bucketInfo.initialized,
                bucketAddress: bucketInfo.bucketAddress,
                bucketAlias: RECALL_BUCKET_ALIAS,
                logPrefix: RECALL_LOG_PREFIX
              }
            }, null, 2)
          }]
        };
      } catch (error) {
        console.error(chalk.red(`❌ Error checking Recall status: ${error instanceof Error ? error.message : String(error)}`));
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              recallStatus: {
                initialized: false,
                error: error instanceof Error ? error.message : String(error)
              }
            }, null, 2)
          }]
        };
      }
    } else if (request.params.name === "listsessions") {
      // Implementation for listing sessions
      try {
        console.error(chalk.blue('🔍 Listing all sequential thinking sessions...'));
        
        // Force initialize if needed
        if (!recallIntegration.isInitialized()) {
          console.error(chalk.yellow('⚠️ Recall not initialized, reinitializing...'));
          await recallIntegration.initializeBucket();
        }
        
        const status = await recallIntegration.getStatusInfo();
        const bucketAddress = status.bucketAddress;
        
        // Get all objects in the bucket
        const allObjects = await recallIntegration.listAllSessionObjects();
        
        // Process session objects
        const sessionObjects = allObjects.map(obj => {
          // Parse the object key to extract information
          const fileName = obj.key;
          const createdTime = obj.metadata?.timestamp || 'Unknown';
          const thoughtCount = obj.metadata?.thoughtCount || 'Unknown';
          
          // Format the created time
          const formattedTime = new Date(createdTime).toLocaleString();
          
          // Create portal link if requested
          const args = request.params.arguments as Record<string, any>;
          const includePortalLinks = args?.includePortalLinks;
          const portalLink = includePortalLinks ? 
            `https://portal.recall.network/buckets/${bucketAddress}?path=${fileName}` : null;
          
          return {
            fileName,
            createdTime: formattedTime,
            thoughtCount,
            ...(portalLink ? { portalLink } : {})
          };
        });
        
        console.error(chalk.green(`✅ Successfully retrieved ${sessionObjects.length} session objects`));
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              sessions: sessionObjects,
              count: sessionObjects.length,
              bucketAddress
            }, null, 2)
          }]
        };
      } catch (error) {
        console.error(chalk.red(`❌ Error listing sessions: ${error instanceof Error ? error.message : String(error)}`));
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
              status: 'failed'
            }, null, 2)
          }],
          isError: true
        };
      }
    } else if (request.params.name === "getsession") {
      // Implementation for retrieving a session
      try {
        const args = request.params.arguments as Record<string, any>;
        const sessionKey = args?.key;
        
        if (!sessionKey) {
          throw new Error('Session key is required');
        }
        
        console.error(chalk.blue(`🔍 Retrieving session file: ${sessionKey}`));
        
        // Force initialize if needed
        if (!recallIntegration.isInitialized()) {
          console.error(chalk.yellow('⚠️ Recall not initialized, reinitializing...'));
          await recallIntegration.initializeBucket();
        }
        
        // Get the session data
        const sessionData = await recallIntegration.getSessionObject(sessionKey);
        
        if (!sessionData) {
          throw new Error(`Session file "${sessionKey}" not found`);
        }
        
        // Get status for portal link
        const status = await recallIntegration.getStatusInfo();
        const portalLink = `https://portal.recall.network/buckets/${status.bucketAddress}?path=${sessionKey}`;
        
        console.error(chalk.green(`✅ Successfully retrieved session: ${sessionKey}`));
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              key: sessionKey,
              content: sessionData,
              portalLink
            }, null, 2)
          }]
        };
      } catch (error) {
        console.error(chalk.red(`❌ Error retrieving session: ${error instanceof Error ? error.message : String(error)}`));
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
              status: 'failed'
            }, null, 2)
          }],
          isError: true
        };
      }
    }

    return {
      content: [{
        type: "text",
        text: `Unknown tool: ${request.params.name}`
      }],
      isError: true
    };
  } catch (error: any) {
    console.error(chalk.red(`❌ Unhandled error in request handler: ${error.message}`));
    console.error(chalk.red(`Stack trace: ${error.stack}`));
    
    return {
      content: [{
        type: "text",
        text: `Error processing request: ${error.message}`
      }],
      isError: true
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  
  // Initialize Recall integration before starting the server
  try {
    console.error(chalk.blue("🔄 Initializing Recall integration before server start..."));
    await recallIntegration.initializeBucket();
    const status = await recallIntegration.getStatusInfo();
    console.error(chalk.green(`✅ Recall initialized successfully: ${JSON.stringify(status, null, 2)}`));
  } catch (error: any) {
    console.error(chalk.yellow(`⚠️ Failed to initialize Recall before server start: ${error.message}`));
  }
  
  await server.connect(transport);
  console.error("Sequential Thinking MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
