# Feature 7411: Let extensions add rental price lines

Reported by the Partner team.

Partners want to add their own price lines to rental contracts (insurance, cleaning fees and the like) from their extensions. Today the lines of a rental contract are fixed by `CGR Rental Pricing` and there is no way to add one.

Requirement:

- `CGR Rental Pricing` publishes an integration event `OnAfterCalcLines(Contract: Record "CGR Rental Contract"; var PriceLine: Record "CGR Invoice Preview Line")`, raised when the price lines of a contract are calculated, once PriceLine holds all of the contract's own lines. Lines a subscriber adds come after the contract's own lines.
- Lines added by a subscriber count wherever a rental contract is priced: the lines and the total of the invoice preview (`CGR Rental Invoice Preview`) and the amount posted to the rental ledger, both when a contract is posted on its own (`CGR Rental Mgt`, Post) and when it is posted in a batch (`CGR Rental Batch Post`).
- An invoice preview must never commit. When a commit is attempted while a preview is being built, for example by a subscriber, building the preview fails and nothing written while it was being built is kept.
- Posting is not affected by that: a subscriber that commits while a contract is posted is handled as it is today. A contract posted on its own is still posted, and batch posting still posts it.
- Without subscribers, previews and posted amounts stay exactly as they are.
