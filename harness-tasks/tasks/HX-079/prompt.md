# Feature 7832: Keep the partner portal token, also when a sign-in fails halfway

Reported by the Integration team.

We sign in to the partner portal with a token that the portal issues. Partner apps need that token to register with the portal after every sign-in. Today we have no place that signs in and keeps the token.

Requirement:

- A new codeunit `CGR Portal Session` (70425, Integration) with `PortalSignIn()`, `PortalToken(): Text` and `ForgetPortalToken()`, and two new integration events `OnIssuePortalToken(var NewToken: Text)` and `OnAfterPortalSignIn(NewToken: Text)`.
- `PortalSignIn()` asks the partner portal for a new token by raising `OnIssuePortalToken`; the portal's connector app answers in `NewToken`.
- When the answer is blank, PortalSignIn fails with the error `The partner portal did not issue a token.` and changes nothing.
- Otherwise the new token replaces the stored token, and PortalSignIn raises `OnAfterPortalSignIn` with it so partner apps can register with the portal. When `OnAfterPortalSignIn` is raised, `PortalToken()` already returns the new token.
- The portal invalidates the previous token the moment it issues a new one. When a partner app raises an error during `OnAfterPortalSignIn`, PortalSignIn fails with that error, but the new token stays stored. Nothing the partner apps wrote during `OnAfterPortalSignIn` is kept, and "Last Portal Sign-In" is not changed.
- When the whole sign-in succeeds, the new field `"Last Portal Sign-In"` (field 70425, DateTime) on `CGR Setup` is set to the current date and time, also when there is no CGR Setup record yet.
- `PortalToken()` returns the stored token, or '' when no token is stored.
- `ForgetPortalToken()` removes the stored token; it does not fail when no token is stored. When a forget is part of a transaction that fails, the forget is undone with it and the token stays stored.

The portal job runs PortalSignIn as its first step.
