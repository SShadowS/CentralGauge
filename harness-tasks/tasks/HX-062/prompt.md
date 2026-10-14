# Task 7713: One place that counts dispatch attempts

Reported by the Integration team.

Today `CGR Outbox Dispatcher` (Integration) counts a dispatch attempt inside DispatchEntry. Support tools and partner apps that deliver outbox entries their own way need to count their attempts exactly the way the dispatcher does.

Requirement:

- Add the public procedure `RecordAttempt(EntryNo: Integer): Integer` to `CGR Outbox Dispatcher`. It counts one dispatch attempt for the outbox entry: Attempts goes up by one and Last Attempt At is set. It returns the entry's new number of attempts.
- An attempt that RecordAttempt has counted stays counted whatever happens afterwards, also when the transaction that called RecordAttempt ends in an error.
- RecordAttempt for an entry number that does not exist raises the platform's error that the outbox entry does not exist.
- DispatchEntry counts its attempts through RecordAttempt.
- Everything else stays as it is today: DispatchEntry, DispatchPending and Requeue, including Sent, Last Error and Failed at the attempt limit.
