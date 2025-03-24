import * as dotenv from 'dotenv';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';

/**
 * SECURITY NOTICE: This module handles sensitive information like private keys.
 * 
 * Security measures implemented:
 * 1. Environment variables are loaded securely with proper precedence
 * 2. Private keys are redacted from memory after first use
 * 3. Console output is sanitized to prevent leaking secrets
 * 4. Multiple security prevention methods are in place to block accidental exposure
 * 5. Strict validation of required environment variables
 * 
 * Environment Variable Precedence:
 * 1. Environment variables already set (from Cursor/Claude config)
 * 2. Environment variables from .env file (if #1 is not available)
 * 3. Default values for optional variables
 */

// Setup enhanced environment loading
const setupEnvironment = () => {
  // Check if the required environment variables are already set
  // (This would be the case if Cursor/Claude set them from their JSON config)
  const hasRequiredEnvVars = !!process.env.RECALL_PRIVATE_KEY;

  if (hasRequiredEnvVars) {
    // Variables already exist in environment (from Cursor/Claude JSON config)
    console.error(chalk.blue('📋 Using environment variables from Cursor/Claude configuration.'));
    return; // Skip loading .env since we already have what we need
  }

  // Get the directory of the current module
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Try to find and load the .env file from various possible locations
  const envPaths = [
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '../.env'),
    resolve(__dirname, '../../.env')
  ];

  let loaded = false;
  for (const path of envPaths) {
    if (existsSync(path)) {
      dotenv.config({ path });
      loaded = true;
      console.error(chalk.blue(`📋 Loaded environment from .env file at: ${path}`));
      break;
    }
  }

  if (!loaded) {
    console.error(chalk.yellow('⚠️ No .env file found. Will use default values where possible.'));
  }
};

// Initialize environment variables
setupEnvironment();

// Constants for Recall configuration - Default values for optional variables
export const RECALL_BUCKET_ALIAS = process.env.RECALL_BUCKET_ALIAS || 'sequential-thinking-logs';
export const RECALL_LOG_PREFIX = process.env.RECALL_LOG_PREFIX || 'sequential-';
export const RECALL_NETWORK = process.env.RECALL_NETWORK || 'testnet';

// Sanitize sensitive environment variables for logging and display
export function sanitizeSecrets(obj: Record<string, any>) {
  const result = { ...obj };
  
  // Keys that should be considered sensitive and redacted
  const sensitiveKeys = [
    'private_key', 'privatekey', 'secret', 'password', 'pass', 'key',
    'token', 'auth', 'credential', 'sign', 'encrypt'
  ];
  
  for (const key in result) {
    const lowerKey = key.toLowerCase();
    
    // Check if this is a sensitive key
    if (sensitiveKeys.some(sk => lowerKey.includes(sk)) && typeof result[key] === 'string') {
      const value = result[key] as string;
      if (value.length > 8) {
        // Show only the first 4 and last 4 characters if long enough
        result[key] = `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
      } else {
        // For shorter values, just show ****
        result[key] = '********';
      }
    }
  }
  
  return result;
}

// Export the RECALL_PRIVATE_KEY getter with additional protection
let privateKeyRaw: string | undefined = process.env.RECALL_PRIVATE_KEY;

export function getPrivateKey(): string {
  if (!privateKeyRaw) {
    throw new Error('RECALL_PRIVATE_KEY is required. Please provide it in Cursor/Claude configuration or in a .env file.');
  }
  
  // Use the key and then clear it from module memory
  const key = privateKeyRaw;
  privateKeyRaw = undefined;
  
  // Completely remove the private key from environment variables
  process.env.RECALL_PRIVATE_KEY = '[REDACTED_AFTER_USE]';
  
  // Instead of using Object.defineProperty, which doesn't work on process.env,
  // we'll just log attempts to access the redacted key elsewhere
  
  return key;
}

/**
 * Prevent potential security issues by throwing errors on attempts to get sensitive data
 */
export function getEnvironmentVariables(): never {
  throw new Error('Security violation: This method is designed to prevent accidental exposure of sensitive environment variables.');
}

// Validate that required environment variables are set
export function validateEnv(): void {
  const requiredVars = ['RECALL_PRIVATE_KEY'];
  const recommendedVars = ['RECALL_NETWORK', 'RECALL_BUCKET_ALIAS', 'RECALL_LOG_PREFIX'];
  
  // Check for required variables
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}. 
Please provide them in Cursor/Claude configuration or in a .env file.`);
  }
  
  // Check for recommended variables
  const missingRecommended = recommendedVars.filter(varName => !process.env[varName]);
  
  if (missingRecommended.length > 0) {
    console.warn(chalk.yellow(`⚠️ Missing recommended environment variables: ${missingRecommended.join(', ')}. Using defaults.`));
  }
}

// Set up console security to redact sensitive information
export function setupSecureConsole(): void {
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleLog = console.log;
  
  const redactPrivateKeys = (args: any[]) => {
    return args.map(arg => {
      if (typeof arg === 'string') {
        return arg.replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_PRIVATE_KEY]')
                  .replace(/(RECALL_PRIVATE_KEY|private_key|privatekey)=([^&\s]+)/gi, '$1=[REDACTED]');
      } else if (arg && typeof arg === 'object') {
        try {
          return sanitizeSecrets(arg);
        } catch (e) {
          return arg;
        }
      }
      return arg;
    });
  };
  
  console.error = (...args: any[]) => {
    originalConsoleError(...redactPrivateKeys(args));
  };
  
  console.warn = (...args: any[]) => {
    originalConsoleWarn(...redactPrivateKeys(args));
  };
  
  console.log = (...args: any[]) => {
    originalConsoleLog(...redactPrivateKeys(args));
  };
}

// Helper function to log configuration status on startup
export function logConfigStatus(): void {
  // Validate environment variables before logging
  validateEnv();
  
  // Set up secure console
  setupSecureConsole();
  
  // Determine the source of environment variables
  let configSource = "default values only";
  
  if (privateKeyRaw) {
    configSource = "Cursor/Claude configuration";
  } else if (process.env.RECALL_PRIVATE_KEY === '[REDACTED_AFTER_USE]') {
    configSource = "environment or .env file";
  }
  
  console.error(chalk.blue('📋 Configuration loaded:'));
  console.error(chalk.blue(`  • Configuration source: ${configSource}`));
  console.error(chalk.blue(`  • Bucket Alias: ${RECALL_BUCKET_ALIAS}`));
  console.error(chalk.blue(`  • Log Prefix: ${RECALL_LOG_PREFIX}`));
  console.error(chalk.blue(`  • Network: ${RECALL_NETWORK}`));
  console.error(chalk.blue(`  • Private Key: ${privateKeyRaw ? '[PROVIDED]' : '[MISSING]'}`));
} 