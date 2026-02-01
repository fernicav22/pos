import { PostgrestError } from '@supabase/supabase-js';

/**
 * Retry logic with exponential backoff
 * Useful for handling transient failures in API calls
 */
export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const isLastAttempt = i === retries - 1;

      if (isLastAttempt) {
        console.error(`All ${retries} retries failed:`, lastError);
        throw lastError;
      }

      // Exponential backoff: 1s, 2s, 4s, 8s, etc.
      const delay = initialDelay * Math.pow(2, i);
      console.log(`Retry ${i + 1}/${retries} after ${delay}ms:`, lastError.message);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Check if error is retryable (transient)
 * Network errors, timeouts, and rate limits should be retried
 */
export function isRetryableError(error: any): boolean {
  // Network errors
  if (error?.message?.includes('NetworkError') || error?.message?.includes('fetch')) {
    return true;
  }

  // Timeout errors
  if (error?.message?.includes('timeout') || error?.message?.includes('TIMEOUT')) {
    return true;
  }

  // Rate limit errors (429)
  if (error?.status === 429) {
    return true;
  }

  // Service unavailable (503)
  if (error?.status === 503) {
    return true;
  }

  // Abort errors (usually from component unmount)
  if (error?.name === 'AbortError') {
    return false; // Don't retry aborts
  }

  return false;
}

/**
 * Format PostgreSQL error for user display
 */
export function formatSupabaseError(error: PostgrestError | Error | null): string {
  if (!error) return 'An unknown error occurred';

  if (error instanceof Error) {
    return error.message || 'An error occurred';
  }

  // PostgrestError
  if ('message' in error) {
    return error.message;
  }

  return 'An error occurred';
}

/**
 * Debounce a function call
 * Useful for preventing rapid repeated calls
 */
export function createDebouncedFn<T extends (...args: any[]) => any>(
  fn: T,
  delay: number = 300
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return function debounced(...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}

/**
 * Create a debounced version with cancel support
 */
export function createCancellableDebouncedFn<T extends (...args: any[]) => any>(
  fn: T,
  delay: number = 300
): {
  call: (...args: Parameters<T>) => void;
  cancel: () => void;
  flush: () => void;
} {
  let timeoutId: NodeJS.Timeout | null = null;
  let lastArgs: Parameters<T> | null = null;

  return {
    call(...args: Parameters<T>) {
      lastArgs = args;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        if (lastArgs) {
          fn(...lastArgs);
        }
        timeoutId = null;
        lastArgs = null;
      }, delay);
    },

    cancel() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
        lastArgs = null;
      }
    },

    flush() {
      if (timeoutId && lastArgs) {
        clearTimeout(timeoutId);
        fn(...lastArgs);
        timeoutId = null;
        lastArgs = null;
      }
    }
  };
}

/**
 * Batch multiple updates into a single request
 * Useful for handling rapid updates to the same resource
 */
export class UpdateBatcher<T extends { id: string }> {
  private pending: Map<string, Partial<T>> = new Map();
  private timeout: NodeJS.Timeout | null = null;
  private batchFn: (updates: Map<string, Partial<T>>) => Promise<void>;
  private batchDelay: number;

  constructor(batchFn: (updates: Map<string, Partial<T>>) => Promise<void>, batchDelay: number = 500) {
    this.batchFn = batchFn;
    this.batchDelay = batchDelay;
  }

  queue(id: string, updates: Partial<T>) {
    const existing = this.pending.get(id) || {};
    this.pending.set(id, { ...existing, ...updates });

    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    this.timeout = setTimeout(() => {
      this.flush();
    }, this.batchDelay);
  }

  async flush() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    if (this.pending.size === 0) {
      return;
    }

    const batch = new Map(this.pending);
    this.pending.clear();

    try {
      await this.batchFn(batch);
    } catch (error) {
      console.error('Batch update failed:', error);
      // Re-queue failed updates?
      throw error;
    }
  }

  cancel() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.pending.clear();
  }
}
