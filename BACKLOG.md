# Backlog — Open Implementation Items

## Absorbed from
- `TODO.md`
- `READY_TO_IMPLEMENT.md`

This file lists only the remaining, still-open tasks extracted verbatim from the source backlog documents.

## Database
- [ ] Run and verify migrations in Supabase (apply new migrations from `supabase/migrations`)
- [ ] Test `draft_orders` table schema and RLS policies
- [ ] Verify `users` table CHECK constraint includes 'customer' role

## POS — Draft Orders API (must implement)
- [ ] `fetchDraftOrders()` - Load user's drafts (query `draft_orders`, filter by `user_id`, order by `updated_at`)
- [ ] `saveDraftOrder()` - Insert or update draft (return inserted/updated row with `.select()`)
- [ ] `loadDraftOrder(draft)` - Convert draft `items` JSONB to cart, validate stock, set `currentDraftId`
- [ ] `deleteDraftOrder(id)` - Delete draft and refresh draft list
- [ ] `clearCurrentDraft()` - Reset current draft state after completion

## POS — UI Components (must add)
- [ ] Add `Save Draft` button to cart view (disabled when cart empty)
- [ ] Add `Load Drafts` button / `Draft List` modal with `Load` and `Delete` actions
- [ ] Add `Save Draft` modal (name input, cancel/save actions)
- [ ] Add `Editing Draft` indicator badge when `currentDraftId` is set
- [ ] Wire draft actions to API functions above

## POS — Edge cases & validations
- [ ] Prevent saving an empty cart (show error)
- [ ] On draft load, adjust quantities to available stock (or flag out-of-stock items)
- [ ] Handle network errors gracefully with toast feedback
- [ ] Avoid state updates after component unmount (use `isMountedRef` / AbortController)

## App routing
- [ ] Update `src/App.tsx` protected routes if needed

## Customer Role — UI adaptations
- [ ] Hide product prices in product grid when `isCustomerRole === true` (prices remain visible in cart)
- [ ] Replace exact quantity numbers with availability badge (`In Stock` / `Out of Stock`) when `canViewQuantities === false`
- [ ] Replace payment flow for `customer` role with `Save as Draft for Staff` primary action
- [ ] Add Training Mode indicator in cart header for `customer` role
- [ ] Ensure staff-completed sales auto-delete corresponding draft when `currentDraftId` exists
- [ ] Simplify customer UI for iPad usage (larger touch targets)

## Testing
- [ ] Role testing: login as `customer`, `cashier`, `manager`, `admin` and verify navigation and permissions
- [ ] Draft order testing: save, load, update, delete drafts; multiple drafts per user
- [ ] Integration testing: ensure RLS policies enforce draft ownership
- [ ] iPad UX testing for `customer` role (touch targets, layout)
- [ ] Performance tests for save/load (verify `.select()` pattern reduces round trips)

## Documentation & Cleanup
- [ ] Update `ROLES.md` (done) and link to draft behavior
- [ ] Add draft orders documentation to implementation history
- [ ] Remove debug code and console logs related to drafts (after verification)
- [ ] Format and lint modified files

---

If you'd like, I can now open and show the specific source lines from `TODO.md` and `READY_TO_IMPLEMENT.md` that contributed each backlog item, or proceed to create `IMPLEMENTATION_HISTORY.md` next.