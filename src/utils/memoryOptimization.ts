/**
 * Memory optimization utilities for the POS application
 */

/**
 * Clears large arrays from memory by setting their length to 0
 * This helps prevent memory leaks when dealing with large data sets
 */
export function clearArray<T>(arr: T[]): void {
  if (arr && Array.isArray(arr)) {
    arr.length = 0;
  }
}

/**
 * Limits the size of an array by removing oldest items (from the beginning)
 * @param arr - The array to limit
 * @param maxSize - Maximum number of items to keep
 * @returns The limited array
 */
export function limitArraySize<T>(arr: T[], maxSize: number): T[] {
  if (arr.length > maxSize) {
    return arr.slice(-maxSize);
  }
  return arr;
}

/**
 * Clears browser cache and localStorage items that are too large
 * This helps prevent browser storage limits from being reached
 */
export function cleanupLocalStorage(): void {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      const item = localStorage.getItem(key);
      if (item && item.length > 1024 * 1024) { // Items larger than 1MB
        console.warn(`Removing large localStorage item: ${key}`);
        localStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.error('Error cleaning up localStorage:', error);
  }
}

/**
 * Debounce function to limit how often a function can be called
 * @param func - The function to debounce
 * @param delay - The delay in milliseconds
 * @returns The debounced function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout;
  
  return function(this: any, ...args: Parameters<T>) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

/**
 * Throttle function to limit how often a function can be called
 * @param func - The function to throttle
 * @param limit - The time limit in milliseconds
 * @returns The throttled function
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  
  return function(this: any, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Checks if memory usage is high (approximation)
 * Uses performance.memory if available (Chrome only)
 */
export function isMemoryHigh(): boolean {
  try {
    if ('memory' in performance && (performance as any).memory) {
      const memory = (performance as any).memory;
      const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
      return usageRatio > 0.9; // More than 90% memory used
    }
  } catch (error) {
    console.error('Error checking memory:', error);
  }
  return false;
}

/**
 * Periodically cleanup function to be called in long-running pages
 */
export function setupPeriodicCleanup(intervalMs: number = 300000): () => void {
  const intervalId = setInterval(() => {
    if (isMemoryHigh()) {
      console.warn('High memory usage detected, triggering cleanup');
      cleanupLocalStorage();
      
      // Force garbage collection if available (only in some browsers/dev mode)
      if (typeof (window as any).gc === 'function') {
        (window as any).gc();
      }
    }
  }, intervalMs);

  // Return cleanup function
  return () => clearInterval(intervalId);
}
