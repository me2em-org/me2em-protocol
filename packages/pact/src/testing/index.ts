// packages/pact/src/testing/index.ts
//
// Subpath entry for the public test fixtures (ТЗ §2 testing/), exported
// via `@me2em/pact/testing` (rc.5) for We2eM/AS integrations and
// downstream package test suites. Not part of the protocol surface —
// deterministic reference material (members, journal builder, voucher
// chains); it may evolve within the rc line without a major bump.
export * from './fixtures.js';
