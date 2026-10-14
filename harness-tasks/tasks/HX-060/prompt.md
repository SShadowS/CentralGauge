# Task 7699: Let the support page see what a dispatch would send

Reported by the Integration team.

Support wants a page that shows which outbox entries the next dispatch would send, before anything is sent. Today the only place that knows which entries are pending is `DispatchPending` in `CGR Outbox Dispatcher` (Integration), and it keeps that knowledge to itself.

Requirement:

- Add to `CGR Outbox Dispatcher` the public procedure `CollectPending(var EntryFilter: Record "CGR Outbox Entry"; var Pending: Record "CGR Outbox Entry" temporary): Integer`.
- CollectPending adds to Pending a copy of every outbox entry that matches the filters on EntryFilter and is pending (not sent and not failed). It returns how many entries it added.
- Rows the caller already has in Pending stay there. An entry that is already in Pending is not added a second time and is not counted.
- Filters the caller has set on Pending are still set after the call, unchanged. The filters on EntryFilter are not changed either.
- `DispatchPending` dispatches exactly the entries CollectPending collects for its EntryFilter, in Entry No. order, and returns the number of entries delivered, as it does today.
- Everything else stays as it is today: DispatchEntry, attempts, Last Error, Failed and Requeue.
