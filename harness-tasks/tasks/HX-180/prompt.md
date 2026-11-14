# Task 5180: Tell the booking partner when a rental contract is deleted

Requested by the Rental desk.

Our online booking partner keeps a copy of every rental contract. It receives our events through the integration outbox (`CGR Outbox Entry` in the Integration app, sent by `CGR Outbox Dispatcher`), and it now asks us to tell it when a contract is deleted, so it can remove its copy.

Bookings that are called off are deleted with `CGR Contract Housekeeping`.CancelBooking in the Rental app, and some other apps delete `CGR Rental Contract` records themselves. Once a year, `CGR Contract Housekeeping`.PurgePostedContracts removes posted contracts that ended more than a year ago from our database; the partner keeps those in its own archive.

Requirement:

- Every rental contract that is deleted, whether by CancelBooking or by another app that deletes `CGR Rental Contract` records itself, queues one outbox entry: Event Type `contractDeleted`, the contract's Vehicle No., and as Payload the JSON `{"event":"contractDeleted","contractNo":"<contract no.>","vehicleNo":"<vehicle no.>"}`.
- The yearly purge of posted contracts tells the partner nothing: running it leaves the outbox as it was.
- CancelBooking and PurgePostedContracts keep their signatures and results, and delete the same contracts as today.
