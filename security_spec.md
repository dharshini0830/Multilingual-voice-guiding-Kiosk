# Security Specification — JanSeva Voice Firestore Rules

## 1. Data Invariants
1. **Default-Deny Baseline**: Every unspecified document path is unconditionally denied (`read, write: if false`).
2. **Verified Owner Isolation**: Every user-scoped document (`/users/{userId}`, `/private/account`, `/drafts/{draftId}`, `/submissions/{submissionId}`) requires an authenticated user with `request.auth.token.email_verified == true` and `request.auth.uid == userId` (or verified `isAdmin()`).
3. **Master Gate**: Subcollections (`private`, `drafts`, `submissions`) enforce parent existence (`exists(/databases/$(database)/documents/users/$(userId))` or `existsAfter(...)` for atomic batches) so orphaned sub-documents cannot exist.
4. **PII Isolation & ID Minimization**: Account emails reside only inside `/users/{userId}/private/account`. Submitted application receipts (`ApplicationSubmission`) store only `maskedIdNumber` (`XXXX-XXXX-1234`), never raw 12-digit Aadhaar numbers.
5. **Immutable Receipts & Owner IDs**: `uid`, `ownerId`, and `createdAt` are immutable once created. `ApplicationSubmission` documents lock at terminal `status == "submitted"` and forbid client-side `update` or `delete`.
6. **Strict Server Timestamps**: Every `createdAt` and `updatedAt` timestamp must strictly equal `request.time`.

## 2. "Dirty Dozen" Attack Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Draft Read**: Unauthenticated client attempts `get` on `/users/u1/drafts/current`.
2. **Unverified Email Write**: Signed-in user with `email_verified: false` attempts `create` on `/users/u1`.
3. **Cross-Tenant Draft Access**: Authenticated user `u2` attempts `get` or `list` on `/users/u1/drafts`.
4. **Cross-Tenant Submission Creation**: Authenticated user `u2` sends `ownerId: "u1"` into `/users/u2/submissions/sub1`.
5. **Shadow / Ghost Field Injection**: User `u1` creates `/users/u1` including undocumented `{ "role": "admin", "isAdmin": true }`.
6. **Admin Spoofing Without Verified Email**: Attacker signs in with unverified token matching admin email (`email_verified: false`) to read `/users/u1/private/account`.
7. **Orphaned Subcollection Write**: User `u1` writes `/users/u1/drafts/current` when parent `/users/u1` does not exist and is not created in the same batch.
8. **Path ID Poisoning (1.5KB Document ID)**: User `u1` writes `/users/u1/submissions/${'A'.repeat(300)}` exceeding `isValidId` 128-char regex guard.
9. **Terminal Receipt Tampering**: User `u1` attempts `update` on `/users/u1/submissions/sub1` to change `fullName` or `status` after submission.
10. **Immutable Owner Swap**: User `u1` updates `/users/u1/drafts/current` attempting to mutate `ownerId` or `createdAt`.
11. **Backdated Client Timestamp**: User `u1` sets `updatedAt` to a client `Timestamp` in `/users/u1/drafts/current` instead of `serverTimestamp()`.
12. **PII Oversized String Exhaustion**: User `u1` submits `address` of length `5000` bytes (> `240` maxLength) or invalid `pincode: "000111"`.
