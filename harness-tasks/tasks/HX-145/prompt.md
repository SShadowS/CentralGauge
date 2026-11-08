# Bug 8664: Re-rated daily rates are rounded to whole units

Reported by Pricing.

When the daily rates change, `CGR Rerating` (Rental) re-rates the open contracts: `RerateBranch` for one branch from the pricing page, and `RerateAll` for every `CGR Branch` in the night job. The night job runs each job through `Codeunit.Run`, logs a failed job and continues with the next one in the same session.

Observed: a factor of 1.05 on a daily rate of 49.90 gives an "Agreed Daily Rate" of 52 instead of 52.40, so every re-rated contract is mispriced.

Expected (unchanged from the original request): re-rating sets "Agreed Daily Rate" of every Open contract of the branch to its vehicle's "Daily Rate" times the factor, rounded to 0.01, and returns the number of contracts it changed; a contract whose vehicle no longer exists stops the re-rating with the usual "does not exist" error. Partners are not told about each re-rated contract: re-rating queues no `contractChanged` partner notification, only one `ratesChanged` notification per branch (Payload = branch code) after that branch's contracts. Every other change to a contract queues its `contractChanged` notification, as `CGR Contract Notifier` does today.

Keep the public procedures of `CGR Rerating` and `CGR Contract Notifier`.
