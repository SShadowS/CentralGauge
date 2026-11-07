# Bug 8139: Customers get rate letters for leases whose rate did not change

Reported by the Lease desk.

Last sprint we shipped the lease rate review in Leasing. `CGR Lease Rate Review` has `ReviewLeaseRates(var LeaseFilter: Record "CGR Lease Contract"): Integer`, which reviews every lease in LeaseFilter, and raises the integration event `OnProposeLeaseRate(LeaseContract: Record "CGR Lease Contract"; var ProposedRate: Decimal)` for each of them. Pricing advisor apps subscribe to it and propose a new base rate in ProposedRate. While an advisor app works out its proposal it writes its own data, for example the letter that tells the customer about the new rate, and some advisor apps commit.

Observed: after last night's review, customers of leases whose rate stayed the same received the advisor app's letter about a new rate.

Expected: a proposal above 0 that differs from the lease's Base Rate by at most 10% is accepted: the lease gets the proposed Base Rate, its schedule is created again as `CGR Lease Mgt`.CreateSchedule creates it, and what the advisor apps wrote for that lease stays. A lease whose proposal is not accepted, or whose review fails, keeps nothing of its review, neither its own changes nor what the advisor apps wrote for it, and the review goes on with the next lease. ReviewLeaseRates returns the number of accepted leases, a proposal equal to the current rate included.

The review is started from a fresh screen, with no unsaved changes. Keep the signatures of `ReviewLeaseRates` and `OnProposeLeaseRate`.
