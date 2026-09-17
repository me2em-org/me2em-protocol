**Me2em never persists your seed.** The seed phrase exists in two
places only: your paper and transient memory during login. This
package stores only *derived, encrypted context caches* — losing your
browser data never loses your identity, because your identity lives
in your head.

## 📦 @me2em/react — React bindings

React bindings for the Me2em protocol: identity lifecycle, seed phrase UX, and hierarchical handle derivation.

## Install

```bash
pnpm add @me2em/react react
```

Requires React >= 18.0.0 as a peer dependency.

## Quick Start

```tsx
import { Me2emProvider, useCreateIdentity } from '@me2em/react';

function App() {
  return (
    <Me2emProvider>
      <CreateIdentityScreen />
    </Me2emProvider>
  );
}

function CreateIdentityScreen() {
  const { status, seedWords, generate, confirmWords, reset } = useCreateIdentity();

  if (status === 'idle') {
    return <button onClick={() => generate()}>Create new identity</button>;
  }

  if (status === 'seed-generated' && seedWords) {
    return (
      <>
        <p>Write down your seed phrase:</p>
        <SeedPhraseDisplay words={seedWords} />
        <button onClick={confirmWords}>I have saved it</button>
      </>
    );
  }

  return <p>Identity ready</p>;
}
```

## Layers

The package has two strict layers:

- **`src/headless/`** — Framework-agnostic logic: identity flow state machines, seed word utilities, validation. This layer **never imports React**. It can be tested without jsdom and will eventually become `@me2em/sdk`.
- **`src/react/`** — React hooks and components that compose headless logic with React state and context.

Headless exports are available under the `headless` namespace:

```ts
import { headless } from '@me2em/react';

const state = headless.identityFlowReducer(headless.initialIdentityFlowState, {
  type: 'GENERATE',
  words: ['abandon', ...],
  seed: new Uint8Array(32),
});
```

## Components

### SeedPhraseDisplay
Shows the seed phrase once. The user reveals the words, can copy them
(allowed exactly once), then dismisses. After dismissal the phrase is
hidden and cannot be re-revealed.

```tsx
<SeedPhraseDisplay
  words={seedWords}
  onDismiss={() => setRevealed(false)}
/>
```

### SeedPhraseVerify
Order-verification component: the user must click the seed phrase words
in the correct order among decoy words in a grid. Auto-checks when all
words are selected; shows "Try again" on failure.

```tsx
<SeedPhraseVerify
  realWords={seedWords}
  onVerified={() => confirmWords()}
  onFailed={(attempts) => console.log(`Failed after ${attempts} attempts`)}
/>
```

### SeedPhraseImport
Step-by-step seed phrase import with 12/24 word toggle, per-word
validation against the BIP39 wordlist, and automatic checksum check.

```tsx
<SeedPhraseImport
  expectedCount={12}
  onImported={(words) => importWords(words)}
/>
```

### PassphraseInput
BIP39 passphrase input with optional security warning. The passphrase
is NFKC-normalized and case-sensitive — a different passphrase silently
derives a different wallet.

```tsx
<PassphraseInput
  onPassphraseChange={(p) => setPassphrase(p)}
  showWarnings={true}
/>
```

## Session management

The `useSession` hook creates and auto-renews signed session tokens for a Handle.

```tsx
import { useHandle, useSession } from '@me2em/react';

function ChatScreen() {
  const handle = useHandle('alice');

  const { session, isExpired, renew } = useSession(handle, {
    audience: 'chat.example.com',
    scopes: ['send', 'receive'],
    ttl: 3600,
  });

  if (isExpired) {
    return <button onClick={renew}>Renew session</button>;
  }

  return <p>Session valid until {new Date(session!.expiresAt * 1000)}</p>;
}
```

The hook auto-renews at half the session TTL by default. Set `autoRenew: false` to disable.

## Identity Context Cache

The Identity Context Cache provides per-identity encrypted storage for Handle context data using IndexedDB with WebCrypto AES-GCM encryption.

```tsx
import {
  IdentityContextIDBStorage,
  useIdentityContext,
  deriveCacheKey,
} from '@me2em/react';

function ContextPanel() {
  const storage = useMemo(() => new IdentityContextIDBStorage(), []);

  // At login time, derive and set the cache key:
  useEffect(() => {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    deriveCacheKey(identitySeed, salt).then((key) => {
      storage.setCacheKey(key);
    });
  }, []);

  const { context, save, clear, refresh } = useIdentityContext(storage);

  if (!context) {
    return <p>No context loaded</p>;
  }

  return (
    <div>
      <p>Identity: {context.identityId}</p>
      <p>Saved: {new Date(context.savedAt)}</p>
      <button onClick={() => save({ ...context, savedAt: Date.now() })}>
        Save
      </button>
      <button onClick={clear}>Clear</button>
    </div>
  );
}
```

Each identity gets a separate IndexedDB database (name = SHA-256 hash of identity ID), guaranteeing full isolation between identities.

## Status

Alpha. API may change between 0.1.x releases. See [packages/core/README.md](../../packages/core/README.md) for the underlying protocol.

Roadmap: @me2em/crypto protocol mechanisms — planned
