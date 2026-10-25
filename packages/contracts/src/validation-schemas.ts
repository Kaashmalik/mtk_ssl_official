import { z } from 'zod';

/**
 * Tenant Validation Schemas
 * Comprehensive input validation for all tenant operations
 */

// UUID validation
export const uuidSchema = z.string().uuid('Invalid UUID format');

// Tenant schemas
export const createTenantSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(100),
  slug: z.string().min(3).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().max(500).optional(),
  website: z.string().url().optional(),
  contactEmail: z.string().email(),
  contactPhone: z.string().regex(/^\+?[1-9]\d{1,14}$/).optional()
});

export const updateTenantSchema = createTenantSchema.partial();

// Match schemas
export const createMatchSchema = z.object({
  tenantId: uuidSchema,
  tournamentId: uuidSchema,
  homeTeamId: uuidSchema,
  awayTeamId: uuidSchema,
  scheduledAt: z.string().datetime(),
  venue: z.string().min(1).max(200),
  matchType: z.enum(['T20', 'ODI', 'TEST', 'T10']),
  overs: z.number().int().positive().max(50)
}).refine(data => data.homeTeamId !== data.awayTeamId, {
  message: 'Home and away teams must be different'
});

export const updateMatchSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  venue: z.string().min(1).max(200).optional(),
  status: z.enum(['scheduled', 'live', 'completed', 'cancelled']).optional()
});

// Team schemas
export const createTeamSchema = z.object({
  tenantId: uuidSchema,
  name: z.string().min(2).max(100),
  shortName: z.string().min(2).max(10),
  logo: z.string().url().optional(),
  primaryColor: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
  secondaryColor: z.string().regex(/^#[0-9A-F]{6}$/i).optional()
});

// Player schemas
export const createPlayerSchema = z.object({
  tenantId: uuidSchema,
  teamId: uuidSchema,
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  email: z.string().email().optional(),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/).optional(),
  dateOfBirth: z.string().date().optional(),
  battingStyle: z.enum(['right_hand', 'left_hand']).optional(),
  bowlingStyle: z.enum(['right_arm_fast', 'left_arm_fast', 'right_arm_spin', 'left_arm_spin', 'none']).optional(),
  role: z.enum(['batsman', 'bowler', 'all_rounder', 'wicket_keeper'])
});

// Scoring schemas
export const scoringDeliverySchema = z.object({
  matchId: uuidSchema,
  tenantId: uuidSchema,
  over: z.number().int().min(0),
  ball: z.number().int().min(1).max(6),
  batsmanId: uuidSchema,
  bowlerId: uuidSchema,
  runs: z.number().int().min(0).max(6),
  extras: z.number().int().min(0).max(5),
  wicket: z.boolean(),
  wicketType: z.enum(['bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket']).optional()
});

// User invitation schema
export const inviteUserSchema = z.object({
  tenantId: uuidSchema,
  email: z.string().email(),
  role: z.enum(['organizer', 'scorer', 'captain', 'player', 'fan']),
  expiresIn: z.number().int().positive().max(30).default(7) // days
});

// Pagination schema
export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

/**
 * Sanitization utilities
 */
export function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/[\x00-\x1F\x7F]/g, ''); // Remove control characters
}

export function sanitizeSearchQuery(query: string): string {
  return query
    .trim()
    .replace(/[^a-zA-Z0-9\s-]/g, '') // Allow only alphanumeric, spaces, and hyphens
    .slice(0, 100); // Limit length
}

/**
 * SQL injection prevention
 * Always use parameterized queries with Drizzle ORM
 */
export function validateSQLIdentifier(identifier: string): boolean {
  // Only allow alphanumeric and underscores for table/column names
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier);
}

/**
 * Rate limiting helpers
 */
export const rateLimitSchema = z.object({
  identifier: z.string(),
  limit: z.number().int().positive(),
  window: z.number().int().positive() // seconds
});

/**
 * File upload validation
 */
export const fileUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  mimetype: z.enum([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'application/pdf'
  ]),
  size: z.number().int().positive().max(10 * 1024 * 1024) // 10MB max
});

/**
 * Webhook validation
 */
export const webhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().min(32).max(64)
});

/**
 * API key validation
 */
export const apiKeySchema = z.object({
  name: z.string().min(3).max(50),
  permissions: z.array(z.string()).min(1),
  expiresAt: z.string().datetime().optional()
});
