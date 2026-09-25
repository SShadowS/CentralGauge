# Feature 4231: Revenue per vehicle

Controlling wants to see what each vehicle earns from rentals and from leases, for any period.

Add three fields to the vehicle, in the Reporting app:

- "Date Filter": a date filter.
- "Rental Revenue" (Decimal): the total amount of the rental ledger entries of the vehicle, limited to posting dates within the date filter when one is set.
- "Lease Revenue" (Decimal): the total amount of the invoiced lease schedule lines for the vehicle, limited to due dates within the date filter when one is set. Lines that are not invoiced do not count.

Both revenue fields are calculated fields (FlowFields), so they can be shown on lists.

Add a "Vehicle No." field (Code[20]) to the lease schedule line (`CGR Lease Schedule Line`, in the Leasing app): the vehicle the line's revenue belongs to. Schedule lines get the vehicle of their lease when the schedule is created.

When the vehicle of a lease contract is changed (validating its "Vehicle No."), the schedule lines that are not invoiced yet move with the lease to the new vehicle at once; lines already invoiced stay with the vehicle they were invoiced on.
