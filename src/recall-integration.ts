import { RecallClient, walletClientFromPrivateKey } from '@recallnet/sdk/client';
import { ChainName, getChain, testnet } from '@recallnet/chains';
import { Address, Hex } from 'viem';
import chalk from 'chalk';
import { config, getPrivateKey, logger } from './config.js';

// Interface for the thought data
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

export interface RecallStatus {
  initialized: boolean;
  bucketAddress: string | null;
  bucketAlias: string;
  logPrefix: string;
  pendingThoughts: number;
}

// Interface for the bucket objects returned by Recall
export interface RecallObject {
  key: string;
  size: number;
  metadata?: {
    timestamp?: number;
    thoughtCount?: number;
    [key: string]: any;
  };
}

class RecallIntegration {
  private client: RecallClient;
  private bucketAddress: Address | null = null;
  private initialized = false;
  private bucketAlias = config.RECALL_BUCKET_ALIAS;
  private logPrefix = config.RECALL_LOG_PREFIX;
  private currentSessionThoughts: (ThoughtData & { timestamp: number, storedAt: string })[] = [];
  private static instance: RecallIntegration;

  private constructor() {
    try {
      // Get the private key from centralized config
      const privateKeyRaw = getPrivateKey();
      const network = config.RECALL_NETWORK;

      // Format the private key: If it doesn't start with "0x", prepend it
      const privateKey = privateKeyRaw.startsWith('0x') 
        ? privateKeyRaw as Hex 
        : `0x${privateKeyRaw}` as Hex;

      const chain = network ? getChain(network as ChainName) : testnet;
      
      // Create the wallet client and immediately clear the private key from memory
      const wallet = walletClientFromPrivateKey(privateKey, chain);
      
      // We don't need to overwrite the privateKey variable since it's a constant
      // and will be garbage collected once this function exits
      
      this.client = new RecallClient({ walletClient: wallet });
      logger.error(chalk.green('📡 Recall client initialized successfully'));
    } catch (error: any) {
      logger.error(chalk.red(`❌ Error initializing Recall in constructor: ${error.message}`));
      throw error;
    }
  }

  public static getInstance(): RecallIntegration {
    if (!RecallIntegration.instance) {
      RecallIntegration.instance = new RecallIntegration();
    }
    return RecallIntegration.instance;
  }

  /**
   * Protect against accidental exposure of environment variables or sensitive data
   * This method will throw an error if called
   */
  public getEnvironmentVariables(): never {
    throw new Error('Security violation: This method is designed to prevent accidental exposure of sensitive environment variables.');
  }

  /**
   * Protect against accidental exposure of private keys
   * This method will throw an error if called
   */
  public getPrivateKey(): never {
    throw new Error('Security violation: This method is designed to prevent accidental exposure of private keys.');
  }

  /**
   * Utility function to handle timeouts for async operations.
   * @param promise The promise to execute.
   * @param timeoutMs The timeout in milliseconds.
   * @param operationName The name of the operation for logging.
   * @returns The result of the promise.
   */
  async withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      throw error;
    }
  }

  /**
   * Initialize bucket (must be called before any operations)
   * This is needed because we can't make constructor async
   */
  public async initializeBucket(): Promise<void> {
    // Skip if already initialized
    if (this.initialized && this.bucketAddress) {
      return;
    }

    try {
      // Get or create bucket with a timeout
      this.bucketAddress = await this.withTimeout(
        this.getOrCreateBucket(this.bucketAlias),
        15000, // 15 second timeout
        'Bucket initialization'
      );
      this.initialized = true;
      logger.error(chalk.green('✅ Recall bucket initialized successfully'));
    } catch (error: any) {
      logger.error(chalk.red(`❌ Error initializing Recall bucket: ${error.message}`));
      throw error;
    }
  }

  /**
   * Ensure initialization is complete before operations
   * Use this at the start of any method that needs a fully initialized client
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized || !this.bucketAddress) {
      await this.initializeBucket();
    }
  }

  /**
   * Get or create a bucket in Recall
   */
  private async getOrCreateBucket(bucketAlias: string): Promise<Address> {
    try {
      logger.error(chalk.blue(`🔍 Looking for bucket with alias: ${bucketAlias}`));

      // Try to find the bucket by alias
      const buckets = await this.client.bucketManager().list();
      if (buckets?.result) {
        const bucket = buckets.result.find((b) => b.metadata?.alias === bucketAlias);
        if (bucket) {
          logger.error(chalk.green(`✅ Found existing bucket "${bucketAlias}" at ${bucket.addr}`));
          return bucket.addr;
        } else {
          logger.error(chalk.yellow(`⚠️ Bucket with alias "${bucketAlias}" not found, creating a new one.`));
        }
      }

      // Create a new bucket
      const query = await this.client.bucketManager().create({
        metadata: { alias: bucketAlias },
      });

      const newBucket = query.result;
      if (!newBucket) {
        throw new Error(`Failed to create bucket: ${bucketAlias}`);
      }

      logger.error(chalk.green(`✅ Successfully created new bucket "${bucketAlias}" at ${newBucket.bucket}`));
      return newBucket.bucket;
    } catch (error: any) {
      logger.error(chalk.red(`❌ Error in getOrCreateBucket: ${error.message}`));
      throw error;
    }
  }

  /**
   * Store the current session's thoughts to Recall as a single JSONL file
   * Each thought is a separate line in the JSONL file
   * @returns The transaction result or undefined if operation failed
   */
  private async storeSessionJSONL(): Promise<{ txHash?: string, success: boolean, key: string } | undefined> {
    await this.ensureInitialized();
    
    if (this.currentSessionThoughts.length === 0) {
      logger.error(chalk.yellow('⚠️ No thoughts to store - returning undefined'));
      return undefined;
    }

    try {
      const timestamp = Date.now();
      const key = `${this.logPrefix}${timestamp}-session.jsonl`;
      
      // Log the current thoughts for debugging
      logger.error(chalk.blue(`📦 Current thoughts in memory:`));
      this.currentSessionThoughts.forEach((thought, index) => {
        logger.error(chalk.blue(`   Thought ${index + 1}: ${JSON.stringify(thought)}`));
      });
      
      // Validate and ensure all thoughts have the required fields
      const validatedThoughts = this.currentSessionThoughts.map((thought, index) => {
        if (!thought.thought) {
          logger.error(chalk.yellow(`⚠️ Missing thought content for thought ${index + 1}, using placeholder`));
          return {
            ...thought,
            thought: `Thought ${index + 1} (content missing)`,
          };
        }
        return thought;
      });
      
      // Convert thoughts to JSONL format (one JSON object per line)
      const jsonlData = validatedThoughts.map(thought => JSON.stringify(thought)).join('\n');
      
      logger.error(chalk.blue(`📦 Storing complete session with ${validatedThoughts.length} thoughts (${jsonlData.length} bytes)`));
      logger.error(chalk.gray(`📄 JSONL data preview: ${jsonlData.substring(0, 200)}...`));
      
      // Add the JSONL data to the bucket with timeout
      let result;
      try {
        result = await this.withTimeout(
          this.client.bucketManager().add(
            this.bucketAddress as `0x${string}`,
            key,
            new TextEncoder().encode(jsonlData),
          ),
          20000, // 20 second timeout
          'Session storage'
        );
      } catch (storageError: any) {
        logger.error(chalk.red(`❌ Error during bucket storage: ${storageError.message}`));
        return {
          success: false,
          key,
          txHash: undefined
        };
      }
      
      // Clear the current session after successful storage
      const thoughtCount = this.currentSessionThoughts.length;
      this.currentSessionThoughts = [];
      
      if (result.meta?.tx) {
        logger.error(chalk.green(`✅ Successfully stored session with ${thoughtCount} thoughts to Recall`));
        logger.error(chalk.green(`🔗 Transaction hash: ${result.meta.tx.transactionHash}`));
        return {
          txHash: result.meta.tx.transactionHash,
          success: true,
          key
        };
      } else {
        logger.error(chalk.yellow(`⚠️ No transaction receipt when storing session - operation queued but not confirmed`));
        return {
          success: true, // Still consider this success as the operation was accepted
          key,
          txHash: undefined
        };
      }
    } catch (error: any) {
      logger.error(chalk.red(`❌ Error storing session to Recall: ${error.message}`));
      return undefined;
    }
  }

  /**
   * Store a complete sequential thinking session to Recall
   * This is an external-facing method that can be called directly
   * @returns The transaction result info or undefined if operation failed
   */
  public async storeSession(thoughts: ThoughtData[], queryInfo?: { query?: string, result?: string, sessionId?: string }): Promise<{ txHash?: string, success: boolean, key: string } | undefined> {
    await this.ensureInitialized();

    try {
      logger.error(chalk.blue(`📦 storeSession called with ${thoughts.length} thoughts and queryInfo: ${JSON.stringify(queryInfo)}`));
      
      // Log the incoming thoughts for debugging
      thoughts.forEach((thought, index) => {
        logger.error(chalk.blue(`   Incoming thought ${index + 1}: ${JSON.stringify(thought)}`));
      });
      
      // MODIFIED: We no longer try to store any current thoughts that might be in memory
      // Instead, we always replace the current thoughts with the incoming batch
      // This ensures we're only storing the complete batch from the server
      
      // Add the new thoughts to our memory, validating content
      const enhancedThoughts = thoughts.map((thought, index) => {
        if (!thought.thought) {
          logger.error(chalk.yellow(`⚠️ Missing thought content for incoming thought ${index + 1}, using placeholder`));
          return {
            ...thought,
            thought: `Thought ${index + 1} (content missing)`,
            timestamp: Date.now(),
            storedAt: new Date().toISOString(),
            query: queryInfo?.query || undefined,
            result: queryInfo?.result || undefined
          };
        }
        
        return {
          ...thought,
          thought: thought.thought, // Explicitly preserve thought content
          timestamp: Date.now(),
          storedAt: new Date().toISOString(),
          query: queryInfo?.query || undefined,
          result: queryInfo?.result || undefined
        };
      });
      
      logger.error(chalk.blue(`📦 Enhanced thoughts: ${JSON.stringify(enhancedThoughts.slice(0, 1))}`));
      
      // Clear any previous thoughts and replace with the new batch
      // This ensures we're only storing what the server explicitly sent us
      logger.error(chalk.blue(`📦 Replacing current thoughts (${this.currentSessionThoughts.length}) with new batch (${enhancedThoughts.length})`));
      this.currentSessionThoughts = enhancedThoughts;
      
      // Store the new session
      logger.error(chalk.blue(`📦 Storing new session with ${thoughts.length} thoughts`));
      return await this.storeSessionJSONL();
    } catch (error: any) {
      logger.error(chalk.red(`❌ Error storing session to Recall: ${error.message}`));
      return undefined;
    }
  }

  /**
   * Gets detailed status information about the Recall integration
   */
  async getStatusInfo(): Promise<RecallStatus> {
    return {
      initialized: this.initialized,
      bucketAddress: this.bucketAddress,
      bucketAlias: this.bucketAlias,
      logPrefix: this.logPrefix,
      pendingThoughts: this.currentSessionThoughts.length
    };
  }

  /**
   * Lists objects in the bucket
   */
  async listBucketObjects(): Promise<string[] | null> {
    await this.ensureInitialized();

    try {
      // Query all objects in the bucket
      const result = await this.client.bucketManager().query(this.bucketAddress as `0x${string}`);
      
      if (result.result?.objects) {
        return result.result.objects.map(obj => obj.key);
      }
      
      return [];
    } catch (error: any) {
      logger.error(chalk.red(`❌ Error listing bucket objects: ${error.message}`));
      return [];
    }
  }

  /**
   * Lists all session objects in the bucket with their metadata
   * @returns Array of objects with key and metadata properties
   */
  async listAllSessionObjects(): Promise<RecallObject[]> {
    await this.ensureInitialized();

    try {
      // Query all objects in the bucket
      const result = await this.client.bucketManager().query(this.bucketAddress as `0x${string}`);
      
      if (!result.result?.objects) {
        return [];
      }
      
      // Filter and map objects to include metadata
      return result.result.objects.map(obj => {
        try {
          // Parse the object key to extract information
          const key = obj.key as string;
          
          // Extract additional metadata
          const metadata: Record<string, any> = {};
          
          // Try to parse metadata from object state/metadata if available
          if (obj.state && 'metadata' in obj.state) {
            // Assign any available metadata from the state object
            const stateMetadata = obj.state.metadata as Record<string, unknown>;
            if (stateMetadata) {
              Object.assign(metadata, stateMetadata);
            }
          }
          
          // If it's a session object, try to extract the timestamp from the filename
          if (key.includes(this.logPrefix)) {
            const timestampMatch = key.match(/-(\d+)-/);
            if (timestampMatch && timestampMatch[1]) {
              metadata.timestamp = parseInt(timestampMatch[1], 10);
            }
          }
          
          return {
            key,
            size: obj.state && 'size' in obj.state ? Number(obj.state.size) : 0,
            metadata
          };
        } catch (error) {
          // If there's an error processing this object, return with minimal info
          return {
            key: obj.key as string,
            size: 0
          };
        }
      }).filter(obj => obj.key.includes(this.logPrefix));
    } catch (error: any) {
      logger.error(chalk.red(`❌ Error listing session objects: ${error.message}`));
      return [];
    }
  }

  /**
   * Gets a specific session object from the bucket and parses it
   * @param key The object key
   * @returns The parsed session object or null if not found
   */
  async getSessionObject(key: string): Promise<any | null> {
    await this.ensureInitialized();

    try {
      // Get the raw content
      const content = await this.getObjectContent(key);
      
      if (!content) {
        return null;
      }
      
      // Parse the JSONL content
      try {
        // Split by lines and parse each line as JSON
        const lines = content.trim().split('\n');
        
        // Parse each line as a separate JSON object
        const thoughts = lines.map((line, index) => {
          try {
            return JSON.parse(line);
          } catch (parseError) {
            logger.error(chalk.yellow(`⚠️ Error parsing line ${index + 1} of session: ${parseError}`));
            return { error: `Invalid JSON at line ${index + 1}`, lineContent: line.substring(0, 50) };
          }
        });
        
        // Return the array of parsed thoughts
        return {
          key,
          thoughts,
          thoughtCount: thoughts.length,
          createdAt: thoughts[0]?.timestamp ? new Date(thoughts[0].timestamp).toISOString() : 'Unknown'
        };
      } catch (parseError) {
        logger.error(chalk.red(`❌ Error parsing session content: ${parseError}`));
        return {
          key,
          error: 'Failed to parse session content',
          rawContent: content.substring(0, 500) + (content.length > 500 ? '...' : '')
        };
      }
    } catch (error: any) {
      logger.error(chalk.red(`❌ Error retrieving session object: ${error.message}`));
      return null;
    }
  }

  /**
   * Gets the content of an object in the bucket
   * @param key The object key
   */
  async getObjectContent(key: string): Promise<string | null> {
    await this.ensureInitialized();

    try {
      const result = await this.client.bucketManager().get(
        this.bucketAddress as `0x${string}`, 
        key
      );
      
      if (result && result.result) {
        // Convert Uint8Array to string
        return new TextDecoder().decode(result.result);
      }
      return null;
    } catch (error) {
      logger.error(`Error getting object content: ${error}`);
      return null;
    }
  }

  /**
   * Check if the Recall client is initialized
   * @returns True if initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
}

// Export a singleton instance
export const recallIntegration = RecallIntegration.getInstance(); 