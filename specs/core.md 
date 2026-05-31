# Me2em Protocol Specification v0.1

## 1. Cryptographic Primitives
- **Root Key**: Ed25519
- **Derivation**: HKDF-SHA256
- **Handle Key**: Ed25519 (independent pair per handle)
- **Signature**: Ed25519 pure

## 2. Identity Derivation
```
RootPrivateKey = HKDF-SHA256(
  InputKeyMaterial = Seed (32 bytes)
  Info = "me2em/identity/v1/root"
  Length = 32
)
```

## 3. Handle Derivation
```
HandlePrivateKey = HKDF-SHA256(
  InputKeyMaterial = RootPrivateKey
  Info = "me2em/handle/v1/<lowercase_name>"
  Length = 32
)
HandleId = Base64Url(Ed25519.PublicKey(HandlePrivateKey))
```

## 4. Authentication Flow
1. Client sends `handleId` → requests challenge
2. Server returns `nonce` (256-bit random, TTL 2m)
3. Client signs `nonce` with `HandlePrivateKey`
4. Client sends `signature`
5. Server verifies with `HandlePublicKey` (from registry)
6. On success: issues `SessionToken(handleId, scopes, expires)`

## 5. Session Token Structure
```json
{
  "handleId": "base64url_pubkey",
  "scopes": ["read:messages", "write:profile"],
  "expiresAt": 1716912000,
  "sig": "ed25519_signature_of_payload"
}
```