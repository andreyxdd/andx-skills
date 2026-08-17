# Golden examples (MR 17)

Finding summary → final MR comment. Tone regression anchor for `/andx-mr-review`.

---

## 1. High — provider init race

**Finding:** Catalog loads before settings; `selectedProvider` sticks on `providers[0]`; never reconciles.

**MR comment:**

```
If the catalog loads before saved settings, `selectedProvider` defaults to `providers[0]`, and the early return on line 69 means we never reconcile when settings arrive for a different stored provider

For example, the profile has provider B saved, catalog returns `[A, B]` → form sticks on A with empty toggles → Save can persist the wrong provider/flags

Possible fix:

```tsx
useEffect(() => {
  if (selectedProvider) return;
  if (!useMocks && (isCatalogLoading || isSettingsLoading)) return;
  const fallback = settings?.provider ?? providers[0]?.provider;
  if (fallback) setSelectedProvider(fallback);
}, [providers, settings, selectedProvider, useMocks, isCatalogLoading, isSettingsLoading]);
```
```

---

## 2. Medium — save without API key

**Finding:** `enabled: true` without `api_key` when field empty.

**MR comment:**

```
User may enable the provider and Save with no stored key and an empty input, so the `handleSave` will still send `enabled: true` without an `api_key`. Backend probably rejects it, but a small client guard would save a round trip:

`disabled={isSaving || (providerEnabled && !hasApiKey && !apiKey.trim())}` on Save or bail in `handleSave` with a toast
```

---

## 3. Medium — validate vs draft key (UX/API)

**Finding:** Validate POST has no body; button disabled when `!hasApiKey`.

**MR comment:**

```
Validate only tests the stored key (`POST .../validate` - no body in the request) but the button is disabled when `!hasApiKey`, so users can't check a key they just typed before committing it

We need to either extend validate to accept a draft `api_key` in the body or make the copy explicit that Save comes first

Right now `validateHint` says "stored key" which is accurate but the UX may fail

```tsx
disabled={(!hasApiKey && !apiKey.trim()) || isValidating}

const handleValidate = async () => {
  try {
    if (apiKey.trim()) {
      await updateSettings({ api_key: apiKey.trim() }).unwrap();
      setApiKey('');
    }
    const result = await validateKey().unwrap();
    // ... existing toast handling
  } catch {
    setToast({ severity: 'error', message: t('compliance.validateFailed') });
  }
};
```

(if we rather not persist on Validate, the alternative is `POST .../validate` with optional `{ api_key }` in the request body and pass `apiKey.trim()` when present)
```

---

## 4. Nitpick — empty tooltip

**Finding:** `hasDetail` true but `tooltipText` empty.

**MR comment:**

```
**nitpick:** `hasDetail` turns on for `detail.sub_status` alone, but `tooltipText` can still be empty when there's no `failed_reason`, `message`, or compliance reason

Could format `sub_status` into the tooltip, or only show the icon when `tooltipText` is non-empty

Possible fix:

```tsx
const tooltipText =
  complianceReason ||
  detail?.failed_reason ||
  (detail?.message ? formatStatus(detail.message) : '') ||
  (detail?.sub_status ? formatStatus(detail.sub_status) : '');

const hasDetail = Boolean(tooltipText);
```
```

---

## 5. Nitpick — show-key adornment

**Finding:** Eye toggle not gated on `canManage`.

**MR comment:**

```
**nitpick:** for consistency with the rest of the form, we can disable the adornment when `!canManage`

```tsx
<IconButton
  onClick={() => setShowKey((v) => !v)}
  edge="end"
  size="small"
  disabled={!canManage}
>
```
```

---

## 6. Nitpick — thread reply (validate double-click)

**Finding:** Save-then-validate could double-fire on double-click.

**MR comment (reply in validate thread):**

```
**nitpick:** the save-then-validate snippet above still only hits the network on button click, not on each typed character — but a fast double-click on Validate could queue two PUT+POST rounds

Low risk; if we care, update the disabled guard:

```tsx
disabled={(!hasApiKey && !apiKey.trim()) || isValidating || isSaving}
```

otherwise the copy-only fix (explicit Save first, no auto-persist on Validate) avoids the extra PUT entirely
```
