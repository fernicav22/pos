import { useState, useCallback } from 'react';
import { PostgrestError } from '@supabase/supabase-js';

/**
 * Hook for optimistic updates with automatic rollback on error
 * 
 * Pattern: Update UI immediately, sync to backend in background
 * Only refetch on error
 */
export function useOptimisticUpdate(
  onSuccess?: () => void,
  onError?: (error: PostgrestError | Error) => void
) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const execute = useCallback(
    async (
      updateFn: () => Promise<{ error?: PostgrestError | null }>,
      optimisticFn: () => void,
      rollbackFn: () => void
    ) => {
      if (isSubmitting) return; // Prevent duplicate submissions
      
      setIsSubmitting(true);
      
      try {
        // Optimistic update - update UI immediately
        optimisticFn();
        
        // Background sync
        const { error } = await updateFn();
        
        // Check for error
        if (error) {
          // Rollback on error
          rollbackFn();
          console.error('Update failed:', error);
          if (onError) onError(error);
          throw error;
        }
        
        // Success
        if (onSuccess) onSuccess();
      } catch (error) {
        console.error('Optimistic update error:', error);
        if (onError) onError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, onSuccess, onError]
  );

  return {
    isSubmitting,
    execute
  };
}

/**
 * Hook for managing lists with optimistic updates
 * Handles add, update, and delete operations
 */
export function useOptimisticList<T extends { id: string }>(
  initialData: T[],
  onDataChange?: (data: T[]) => void
) {
  const [items, setItems] = useState<T[]>(initialData);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const add = useCallback(
    async (
      updateFn: () => Promise<{ data?: T; error?: PostgrestError | null }>,
      newItem: T
    ) => {
      if (isSubmitting) return;
      setIsSubmitting(true);

      try {
        // Optimistic add
        setItems(prev => [newItem, ...prev]);
        
        const { data, error } = await updateFn();
        
        if (error) {
          // Rollback
          setItems(prev => prev.filter(item => item.id !== newItem.id));
          throw error;
        }
        
        // Update with server data if different
        if (data && data.id !== newItem.id) {
          setItems(prev => prev.map(item => item.id === newItem.id ? data : item));
        }
        
        if (onDataChange) onDataChange(items);
      } catch (error) {
        console.error('Add failed:', error);
        throw error;
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, items, onDataChange]
  );

  const update = useCallback(
    async (
      id: string,
      updateFn: () => Promise<{ data?: T; error?: PostgrestError | null }>,
      updates: Partial<T>
    ) => {
      if (isSubmitting) return;
      setIsSubmitting(true);

      const oldItem = items.find(item => item.id === id);
      
      try {
        // Optimistic update
        setItems(prev => prev.map(item => 
          item.id === id ? { ...item, ...updates } : item
        ));
        
        const { data, error } = await updateFn();
        
        if (error) {
          // Rollback
          setItems(prev => prev.map(item => 
            item.id === id ? (oldItem || item) : item
          ));
          throw error;
        }
        
        // Update with server data if provided
        if (data) {
          setItems(prev => prev.map(item => item.id === id ? data : item));
        }
        
        if (onDataChange) onDataChange(items);
      } catch (error) {
        console.error('Update failed:', error);
        throw error;
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, items, onDataChange]
  );

  const remove = useCallback(
    async (
      id: string,
      updateFn: () => Promise<{ error?: PostgrestError | null }>
    ) => {
      if (isSubmitting) return;
      setIsSubmitting(true);

      const oldItem = items.find(item => item.id === id);
      
      try {
        // Optimistic remove
        setItems(prev => prev.filter(item => item.id !== id));
        
        const { error } = await updateFn();
        
        if (error) {
          // Rollback
          if (oldItem) {
            setItems(prev => [oldItem, ...prev]);
          }
          throw error;
        }
        
        if (onDataChange) onDataChange(items);
      } catch (error) {
        console.error('Delete failed:', error);
        throw error;
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, items, onDataChange]
  );

  return {
    items,
    setItems,
    isSubmitting,
    add,
    update,
    remove
  };
}
