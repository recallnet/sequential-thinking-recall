import sodium from 'sodium-native';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

// Define types for configuration variables
interface Config {
  RECALL_BUCKET_ALIAS: string;
  RECALL_LOG_PREFIX: string;
  RECALL_NETWORK: string;
}

// Define logger interface
interface Logger {
  error: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  info: (...args: any[]) => void;
}

// Redaction function with type safety
const redactSensitive = (input: any): any => {
  if (typeof input === 'string') {
    return input
      .replace(/[0-9a-fA-F]{64}/g, '[REDACTED_KEY]') // Hex keys
      .replace(/[^=&\s]{32,}/g, '[REDACTED_LONG_VALUE]') // Long strings
      .replace(/(private_key|secret|key|token|password)=([^&\s]+)/gi, '$1=[REDACTED]');
  }
  if (input && typeof input === 'object') {
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = key.toLowerCase().includes('key') || key.toLowerCase().includes('secret')
        ? '[REDACTED]'
        : redactSensitive(value);
    }
    return sanitized;
  }
  return input;
};

// Custom logger implementation
export const logger: Logger = {
  error: (...args: any[]) => process.stderr.write(`${chalk.red('[ERROR]')} ${args.map(redactSensitive).join(' ')}\n`),
  warn: (...args: any[]) => process.stderr.write(`${chalk.yellow('[WARN]')} ${args.map(redactSensitive).join(' ')}\n`),
  info: (...args: any[]) => process.stderr.write(`${chalk.blue('[INFO]')} ${args.map(redactSensitive).join(' ')}\n`),
};

// Secure secret storage
let secretBuffer: sodium.SecureBuffer | null = null;
let secretLoaded: boolean = false;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_FILE_PATH: string = resolve(__dirname, '..', '.env');
const EXPECTED_ENV_HASH: string | null = process.env.ENV_FILE_HASH || null; // Optional integrity hash

// Load secrets with priority: external env > .env file
const loadSecrets = (): void => {
  if (secretLoaded) return;

  // Check external environment first
  const externalKey: string | undefined = process.env.RECALL_PRIVATE_KEY;
  if (externalKey) {
    secretBuffer = sodium.sodium_malloc(externalKey.length) as sodium.SecureBuffer;
    secretBuffer.write(externalKey);
    sodium.sodium_mlock(secretBuffer); // Lock memory to prevent swapping
    process.env.RECALL_PRIVATE_KEY = '[REDACTED]'; // Redact immediately
    logger.info('Using RECALL_PRIVATE_KEY from external environment variables.');
    secretLoaded = true;
    return;
  }

  // Fall back to .env file
  try {
    const envContent: string = readFileSync(ENV_FILE_PATH, 'utf8');
    // Optional: Verify integrity with a precomputed hash
    if (EXPECTED_ENV_HASH) {
      const computedHash: string = createHash('sha256').update(envContent).digest('hex');
      if (computedHash !== EXPECTED_ENV_HASH) {
        throw new Error('Integrity check failed: .env file hash does not match expected value.');
      }
    }

    const envVars: Record<string, string> = envContent.split('\n').reduce((acc, line) => {
      const [key, value] = line.split('=');
      if (key && value) acc[key.trim()] = value.trim();
      return acc;
    }, {} as Record<string, string>);

    const envKey: string | undefined = envVars.RECALL_PRIVATE_KEY;
    if (!envKey) {
      throw new Error('RECALL_PRIVATE_KEY not found in .env file.');
    }

    secretBuffer = sodium.sodium_malloc(envKey.length) as sodium.SecureBuffer;
    secretBuffer.write(envKey);
    sodium.sodium_mlock(secretBuffer); // Lock memory to prevent swapping
    process.env.RECALL_PRIVATE_KEY = '[REDACTED]';
    logger.info(`Loaded RECALL_PRIVATE_KEY from .env file at: ${ENV_FILE_PATH}`);
    secretLoaded = true;
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error);
    logger.warn(`No valid .env file found or RECALL_PRIVATE_KEY missing: ${message}. Will fail if required.`);
  }
};

// Initialize secrets
loadSecrets();

// Export configuration object using Config interface
export const config: Config = {
  RECALL_BUCKET_ALIAS: process.env.RECALL_BUCKET_ALIAS || 'sequential-thinking-logs',
  RECALL_LOG_PREFIX: process.env.RECALL_LOG_PREFIX || 'sequential-',
  RECALL_NETWORK: process.env.RECALL_NETWORK || 'testnet',
};

// Secure private key access
export function getPrivateKey(): string {
  if (!secretBuffer) {
    throw new Error('RECALL_PRIVATE_KEY is required but not available.');
  }

  const key: string = secretBuffer.toString('utf8');
  sodium.sodium_memzero(secretBuffer); // Zero out immediately after use
  sodium.sodium_munlock(secretBuffer); // Unlock and zero memory
  secretBuffer = null;
  secretLoaded = false; // Force reload if needed again
  return key;
}

// Validate environment
export function validateEnv(): void {
  if (!secretLoaded && !secretBuffer) {
    throw new Error('Missing required RECALL_PRIVATE_KEY. Provide it via environment variables or .env.');
  }
  const recommendedVars: (keyof Config)[] = ['RECALL_NETWORK', 'RECALL_BUCKET_ALIAS', 'RECALL_LOG_PREFIX'];
  const missing: string[] = recommendedVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    logger.warn(`Missing recommended variables: ${missing.join(', ')}. Using defaults.`);
  }
}

// Setup logging and status
export function logConfigStatus(): void {
  validateEnv();
  logger.info('Configuration loaded:');
  logger.info(`  • Source: ${secretLoaded ? (process.env.RECALL_PRIVATE_KEY === '[REDACTED]' ? 'external' : '.env') : 'none'}`);
  logger.info(`  • Bucket Alias: ${config.RECALL_BUCKET_ALIAS}`);
  logger.info(`  • Log Prefix: ${config.RECALL_LOG_PREFIX}`);
  logger.info(`  • Network: ${config.RECALL_NETWORK}`);
  logger.info(`  • Private Key: ${secretBuffer ? '[PROVIDED]' : '[MISSING]'}`);
}