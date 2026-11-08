# Bug 6274: Monthly usage report shows kilometres as revenue

Reported by Fleet management.

Last sprint we shipped the monthly usage report in Reporting: table `CGR Monthly Usage Buffer` (70560), query `CGR Vehicle Period Usage` (70561) and codeunit `CGR Monthly Usage Report` (70562) with `FillMonthlyUsage(FromDate: Date; ToDate: Date; var Buffer: Record "CGR Monthly Usage Buffer" temporary)`.

Observed: the report shows the kilometres driven in the Revenue column and the revenue in the Km Driven column. Fleet managers have been retiring the wrong vehicles.

Expected (unchanged from the original request): `FillMonthlyUsage` fills the buffer with one row per vehicle that is not Blocked, also for a vehicle that was not rented in the period, since the fleet managers use the report to find exactly those: Revenue is the sum of Amount, Km Driven the sum of "Km Driven" and Rentals the number of the vehicle's rental ledger entries whose Posting Date is within FromDate..ToDate, each 0 when there are none. Blocked vehicles are not listed, and after a fill the buffer holds only the rows of that fill.

Keep the signature of `FillMonthlyUsage`.
