/**
 * Environment Configuration Validation
 * 
 * Validates all required environment variables on boot (fail fast).
 */

import { z } from 'zod';

const requiredEnvSchema = z.object({
  // Server
  PORT: z.string().regex(/^\d+$/).transform(Number).default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Database (required)
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),
  
  // Security (required)
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CORS_ALLOWED_ORIGINS: z.string().min(1, 'CORS_ALLOWED_ORIGINS must be set to explicit origins'),
  
  // Cookies
  COOKIE_SECURE: z.string().optional().transform(val => val === 'true'),
  COOKIE_SAMESITE: z.enum(['Lax', 'Strict', 'None']).default('Lax'),
  COOKIE_DOMAIN: z.string().optional(),
  
  // Trust proxy
  TRUST_PROXY: z.string().default('false'),
  
  // Rate limiting
  RATE_LIMIT_LOGIN_MAX: z.string().regex(/^\d+$/).transform(Number).default('8'),
  RATE_LIMIT_LOGIN_WINDOW_SEC: z.string().regex(/^\d+$/).transform(Number).default('600'),
  RATE_LIMIT_GENERATION_MAX: z.string().regex(/^\d+$/).transform(Number).default('30'),
  RATE_LIMIT_GENERATION_WINDOW_SEC: z.string().regex(/^\d+$/).transform(Number).default('300'),
  
  // Metrics
  METRICS_ENABLED: z.string().optional().transform(val => val === 'true'),
  METRICS_AUTH_TOKEN: z.string().optional(),
});

const optionalEnvSchema = z.object({
  // AI Providers (at least one required)
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  DEEPRUN_DEFAULT_PROVIDER: z.enum(['openai', 'anthropic', 'mock']).optional(),
  
  // Agent configuration
  AGENT_FS_MAX_FILES_PER_STEP: z.string().regex(/^\d+$/).transform(Number).optional(),
  AGENT_FS_MAX_TOTAL_DIFF_BYTES: z.string().regex(/^\d+$/).transform(Number).optional(),
  AGENT_FS_MAX_FILE_BYTES: z.string().regex(/^\d+$/).transform(Number).optional(),
  AGENT_LIGHT_VALIDATION_MODE: z.enum(['off', 'warn', 'enforce']).optional(),
  AGENT_HEAVY_VALIDATION_MODE: z.enum(['off', 'warn', 'enforce']).optional(),
  AGENT_CORRECTION_POLICY_MODE: z.enum(['off', 'warn', 'enforce']).optional(),
  
  // V1 readiness
  V1_DOCKER_BIN: z.string().default('docker'),
  V1_DOCKER_BUILD_TIMEOUT_MS: z.string().regex(/^\d+$/).transform(Number).optional(),
  V1_DOCKER_BOOT_TIMEOUT_MS: z.string().regex(/^\d+$/).transform(Number).optional(),
  
  // Deployment
  DEPLOY_DOCKER_BIN: z.string().default('docker'),
  DEPLOY_REGISTRY: z.string().optional(),
  DEPLOY_BASE_DOMAIN: z.string().default('deeprun.app'),
  DEPLOY_PUBLIC_URL_TEMPLATE: z.string().optional(),
  DEPLOY_DOCKER_NETWORK: z.string().optional(),
  DEPLOY_CONTAINER_PORT: z.string().regex(/^\d+$/).transform(Number).default('3000'),
  DEPLOY_STOP_PREVIOUS: z.string().optional().transform(val => val !== 'false'),
});

export interface ValidatedConfig {
  // Server
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  
  // Database
  databaseUrl: string;
  
  // Security
  jwtSecret: string;
  corsAllowedOrigins: string[];
  cookieSecure: boolean;
  cookieSameSite: 'Lax' | 'Strict' | 'None';
  cookieDomain?: string;
  
  // Trust proxy
  trustProxy: boolean | number | string | string[];
  
  // Rate limiting
  rateLimiting: {
    loginMax: number;
    loginWindowSec: number;
    generationMax: number;
    generationWindowSec: number;
  };
  
  // Metrics
  metrics: {
    enabled: boolean;
    authToken?: string;
  };
  
  // AI Providers
  providers: {
    openaiApiKey?: string;
    anthropicApiKey?: string;
    defaultProvider?: 'openai' | 'anthropic' | 'mock';
  };
  
  // Agent
  agent: {
    maxFilesPerStep?: number;
    maxTotalDiffBytes?: number;
    maxFileBytes?: number;
    lightValidationMode?: 'off' | 'warn' | 'enforce';
    heavyValidationMode?: 'off' | 'warn' | 'enforce';
    correctionPolicyMode?: 'off' | 'warn' | 'enforce';
  };
  
  // V1 readiness
  v1: {
    dockerBin: string;
    dockerBuildTimeoutMs?: number;
    dockerBootTimeoutMs?: number;
  };
  
  // Deployment
  deployment: {
    dockerBin: string;
    registry?: string;
    baseDomain: string;
    publicUrlTemplate?: string;
    dockerNetwork?: string;
    containerPort: number;
    stopPrevious: boolean;
  };
}

function parseTrustProxy(value: string): boolean | number | string | string[] {
  const trimmed = value.trim();
  
  if (!trimmed || trimmed === 'false') {
    return false;
  }
  
  if (trimmed === 'true') {
    return true;
  }
  
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  
  if (trimmed.includes(',')) {
    return trimmed.split(',').map(entry => entry.trim()).filter(Boolean);
  }
  
  return trimmed;
}

export function validateEnvironment(): ValidatedConfig {
  try {
    // Validate required environment variables
    const required = requiredEnvSchema.parse(process.env);
    const optional = optionalEnvSchema.parse(process.env);
    
    // Parse CORS origins
    const corsOrigins = required.CORS_ALLOWED_ORIGINS
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean);
    
    if (!corsOrigins.length) {
      throw new Error('CORS_ALLOWED_ORIGINS must contain at least one origin');
    }
    
    if (corsOrigins.includes('*')) {
      throw new Error('CORS_ALLOWED_ORIGINS cannot include "*". Use explicit origins.');
    }
    
    // Validate at least one AI provider
    if (!optional.OPENAI_API_KEY && !optional.ANTHROPIC_API_KEY) {
      console.warn('⚠️  No AI provider API keys configured. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to enable generation.');
    }
    
    // Validate cookie security
    if (required.COOKIE_SAMESITE === 'None' && !required.COOKIE_SECURE) {
      throw new Error('COOKIE_SAMESITE=None requires COOKIE_SECURE=true');
    }
    
    return {
      port: required.PORT,
      nodeEnv: required.NODE_ENV,
      databaseUrl: required.DATABASE_URL,
      jwtSecret: required.JWT_SECRET,
      corsAllowedOrigins: corsOrigins,
      cookieSecure: required.COOKIE_SECURE,
      cookieSameSite: required.COOKIE_SAMESITE,
      cookieDomain: required.COOKIE_DOMAIN,
      trustProxy: parseTrustProxy(required.TRUST_PROXY),
      rateLimiting: {
        loginMax: required.RATE_LIMIT_LOGIN_MAX,
        loginWindowSec: required.RATE_LIMIT_LOGIN_WINDOW_SEC,
        generationMax: required.RATE_LIMIT_GENERATION_MAX,
        generationWindowSec: required.RATE_LIMIT_GENERATION_WINDOW_SEC,
      },
      metrics: {
        enabled: required.METRICS_ENABLED || false,
        authToken: required.METRICS_AUTH_TOKEN,
      },
      providers: {
        openaiApiKey: optional.OPENAI_API_KEY,
        anthropicApiKey: optional.ANTHROPIC_API_KEY,
        defaultProvider: optional.DEEPRUN_DEFAULT_PROVIDER,
      },
      agent: {
        maxFilesPerStep: optional.AGENT_FS_MAX_FILES_PER_STEP,
        maxTotalDiffBytes: optional.AGENT_FS_MAX_TOTAL_DIFF_BYTES,
        maxFileBytes: optional.AGENT_FS_MAX_FILE_BYTES,
        lightValidationMode: optional.AGENT_LIGHT_VALIDATION_MODE,
        heavyValidationMode: optional.AGENT_HEAVY_VALIDATION_MODE,
        correctionPolicyMode: optional.AGENT_CORRECTION_POLICY_MODE,
      },
      v1: {
        dockerBin: optional.V1_DOCKER_BIN,
        dockerBuildTimeoutMs: optional.V1_DOCKER_BUILD_TIMEOUT_MS,
        dockerBootTimeoutMs: optional.V1_DOCKER_BOOT_TIMEOUT_MS,
      },
      deployment: {
        dockerBin: optional.DEPLOY_DOCKER_BIN,
        registry: optional.DEPLOY_REGISTRY,
        baseDomain: optional.DEPLOY_BASE_DOMAIN,
        publicUrlTemplate: optional.DEPLOY_PUBLIC_URL_TEMPLATE,
        dockerNetwork: optional.DEPLOY_DOCKER_NETWORK,
        containerPort: optional.DEPLOY_CONTAINER_PORT,
        stopPrevious: optional.DEPLOY_STOP_PREVIOUS,
      },
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = 'Environment configuration validation failed:\n' +
        error.issues.map(issue => `   ${issue.path.join('.')}: ${issue.message}`).join('\n') +
        '\n\nPlease check your environment variables and try again.\n' +
        'See docs/configuration.md for details.';
      
      if (process.env.NODE_ENV === 'test') {
        throw new Error(errorMessage);
      }
      
      console.error('❌ ' + errorMessage);
      process.exit(1);
    }
    
    const errorMessage = 'Environment validation error: ' + (error instanceof Error ? error.message : String(error));
    
    if (process.env.NODE_ENV === 'test') {
      throw new Error(errorMessage);
    }
    
    console.error('❌ ' + errorMessage);
    process.exit(1);
  }
}