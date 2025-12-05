# Testing Guide - Authentication Fixes

## Quick Test Scenarios

### 1. Basic Page Refresh Test
**Steps**:
1. Log in to the application
2. Navigate to any page (e.g., Dashboard, POS)
3. Press F5 or Ctrl+R to refresh
4. Observe the console logs

**Expected Result**:
- Page should load smoothly without getting stuck
- Should see "AuthStore: Initializing auth..." once
- Should see "AuthStore: Found existing session" once
- Should see "AuthStore: Fetching user data for ID: xxx" once
- Should NOT see duplicate fetch messages
- Loading screen should disappear within 1-2 seconds

**Console Output Should Look Like**:
```
AuthStore: Module loaded, initializing...
AuthStore: Initializing auth...
AuthStore: Found existing session
AuthStore: Fetching user data for ID: c4e94c48-5289-4d77-a5f0-6d66fedf4f08
AuthStore: User data fetched successfully
AuthStore: Setting user state
AuthStore: setUser called with: user data
App: Loading settings for authenticated user
SettingsStore: Loading settings from database
SettingsStore: Settings loaded successfully
```

---

### 2. Multiple Rapid Refreshes Test
**Steps**:
1. Log in to the application
2. Rapidly press F5 multiple times (5-10 times quickly)
3. Observe console logs

**Expected Result**:
- Should see deduplication messages
- Should NOT make multiple API calls per refresh
- Should eventually load successfully
- Console should show: "AuthStore: Deduplicating user fetch request"

---

### 3. Login Flow Test
**Steps**:
1. Log out if logged in
2. Go to login page
3. Enter credentials and click "Sign in"
4. Observe the transition

**Expected Result**:
- Should see "Signing in..." button text
- Should automatically redirect to dashboard
- Should NOT see any delays or stuck states
- Console should show: "Login successful - auth state will handle navigation"

---

### 4. Logout Test
**Steps**:
1. While logged in, click logout
2. Observe the transition

**Expected Result**:
- Should immediately redirect to login page
- Should clear user state
- Console should show: "AuthStore: SIGNED_OUT event, clearing user"

---

### 5. Network Timeout Test (Simulated)
**Steps**:
1. Open DevTools → Network tab
2. Set throttling to "Slow 3G" or "Offline"
3. Try to refresh the page
4. Wait 10 seconds

**Expected Result**:
- Should show loading screen
- After 10 seconds, should either:
  - Load successfully if network recovered
  - Show error and redirect to login if timeout
- Should NOT get stuck indefinitely

---

### 6. Settings Load Timeout Test
**Steps**:
1. Open DevTools → Network tab
2. Block requests to `store_settings` table
3. Log in
4. Wait 5 seconds

**Expected Result**:
- Should show "Loading settings..." for up to 5 seconds
- After 5 seconds, should proceed with default settings
- Console should show: "App: Settings load timeout, proceeding with defaults"
- Application should still be usable

---

### 7. Hot Reload Test (Development Only)
**Steps**:
1. Start dev server: `npm run dev`
2. Log in to the application
3. Make a small change to any file (e.g., add a comment)
4. Save the file to trigger hot reload
5. Check console logs

**Expected Result**:
- Should see: "AuthStore: Hot reload cleanup"
- Should NOT accumulate multiple auth listeners
- Application should reload smoothly
- Should maintain logged-in state

---

### 8. Token Refresh Test
**Steps**:
1. Log in to the application
2. Wait for token to refresh (happens automatically every ~50 minutes)
3. Or manually trigger by waiting 1 hour
4. Observe console logs

**Expected Result**:
- Should see: "AuthStore: TOKEN_REFRESHED event, session still valid"
- Should NOT refetch user data
- Should NOT cause any UI flicker
- Application should continue working normally

---

## Console Log Patterns

### ✅ Good Patterns (What You Want to See)
```
✅ AuthStore: Initializing auth...
✅ AuthStore: Found existing session
✅ AuthStore: Fetching user data for ID: xxx
✅ AuthStore: User data fetched successfully
✅ AuthStore: Deduplicating user fetch request (if multiple calls)
✅ SettingsStore: Loading settings from database
✅ SettingsStore: Settings loaded successfully
```

### ❌ Bad Patterns (What You DON'T Want to See)
```
❌ Multiple "Fetching user data" messages in quick succession
❌ "Error fetching user data" without recovery
❌ Infinite loading with no resolution
❌ Multiple auth listeners being registered
❌ Memory leak warnings
```

---

## Performance Checks

### Before Fixes (What You Were Seeing)
- 2-4 user fetch calls on refresh
- Stuck loading screens
- Console spam with duplicate messages

### After Fixes (What You Should See Now)
- 1 user fetch call on refresh
- Smooth loading transitions
- Clean, organized console logs
- Deduplication messages when appropriate

---

## Troubleshooting

### If Page Gets Stuck Loading
1. Check console for errors
2. Look for timeout messages (should appear after 10s for auth, 5s for settings)
3. Check Network tab for failed requests
4. Try clearing localStorage and refreshing

### If You See Duplicate Fetches
1. Check if hot reload is causing issues (development only)
2. Verify the deduplication logic is working
3. Check console for "Deduplicating" messages

### If Login Doesn't Work
1. Check console for error messages
2. Verify credentials are correct
3. Check Network tab for auth request
4. Look for "Login error:" in console

---

## Success Criteria

The fixes are working correctly if:
- ✅ Page refreshes load smoothly without getting stuck
- ✅ Only 1 user fetch per refresh (not 2-4)
- ✅ Console logs are clean and organized
- ✅ No memory leaks or duplicate listeners
- ✅ Timeout protection works (10s auth, 5s settings)
- ✅ Login/logout flows work smoothly
- ✅ Token refresh doesn't cause issues
- ✅ Hot reload doesn't accumulate listeners

---

## Next Steps

After testing, if everything works:
1. ✅ Mark this issue as resolved
2. ✅ Monitor production for any edge cases
3. ✅ Consider adding analytics to track auth performance

If issues persist:
1. ❌ Check console logs for specific errors
2. ❌ Review the AUTH_RACE_CONDITIONS_ANALYSIS.md
3. ❌ File a detailed bug report with logs
