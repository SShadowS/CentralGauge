# Feature 7503: Let transports keep a delivery receipt

Reported by the Integration team.

Our transports are the subscribers of the `OnSendEntry` event of `CGR Outbox Dispatcher` (Integration). Some of them need to write to the database while they send an outbox entry, for example to store a delivery receipt. Today a transport cannot keep anything it writes while it sends.

Requirement:

- A transport may write to the database while it sends an entry. When the send succeeds, what the transport wrote is kept.
- When the send fails, because the transport raises an error or leaves Delivered false, nothing the transport wrote during that send is kept. The entry records the attempt as it does today: Attempts, Last Attempt At, Last Error with the error text, and Failed once the maximum number of attempts is reached.
- `OnSendEntry` keeps its publisher, its name and its parameters.
- Everything else stays as it is today: what `DispatchEntry` and `DispatchPending` return, the error texts, and the behaviour with a transport that writes nothing or with no transport at all.
