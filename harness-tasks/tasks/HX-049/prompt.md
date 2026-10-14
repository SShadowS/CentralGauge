# Task 7622: Partner apps plug in their own outbox transport

Reported by the Integration team.

Today `CGR Outbox Dispatcher` (Integration) delivers an outbox entry only by raising its OnSendEntry event. Partner apps want to ship their own way of delivering outbox entries and let the customer choose which one is used.

Requirement:

- Add the interface `CGR Outbox Transport` with the procedure `Send(Entry: Record "CGR Outbox Entry"): Boolean`. Send returns true when the entry was delivered.
- Add the enum `CGR Outbox Transport` (ID 70415) with the value `Event` (0). Partner apps add their own transports by adding values to this enum in their own apps, each with its own transport. A value a partner adds without its own transport sends through the Event transport.
- Add the codeunit `CGR Event Transport` (ID 70416), the transport behind `Event`. It delivers exactly as the dispatcher does today: OnSendEntry is raised and its subscribers keep working unchanged.
- Add the field "Outbox Transport" (the enum above) to `CGR Setup`. It chooses the transport; Event is the default.
- DispatchEntry sends every entry through the chosen transport. Send true means delivered; Send false or an error means not delivered, and Last Error holds the error text, or the existing "Outbox entry N was not delivered." text, exactly as today.
- Everything else stays as it is today: attempts, Failed, Requeue, DispatchPending and its return value.
