# @me2em/react

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

## Status

Alpha. API may change between 0.1.x releases. See [packages/core/README.md](../../packages/core/README.md) for the underlying protocol.
