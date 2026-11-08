# Feature 6352: Re-price open contracts without flooding the booking partner

Requested by Pricing.

When the daily rates change, Pricing re-prices every open rental contract. Each save of a contract queues a `contractChanged` message for the booking partner, so a re-pricing of 4,000 contracts would send 4,000 messages; the partner wants one `ratesChanged` message per branch instead. Integration already keeps the partner messages quiet during the booking import, through `CGR Integration Silencer`.

Add codeunit `CGR Contract Repricing` with `RepriceOpenContracts(NewRateFactor: Decimal): Integer`. It sets "Agreed Daily Rate" on every Open contract to its vehicle's Daily Rate times NewRateFactor, rounded to 0.01, saves the contract, and returns the number of contracts it re-priced.

Contract: a re-pricing queues no `contractChanged` message, and queues one `ratesChanged` message (Payload = the branch code) for each branch with re-priced contracts. Apart from that message, saving a re-priced contract does everything a contract save does, so a contract that cannot be changed cannot be re-priced either and the re-pricing stops with that save's error. Contract changes outside a re-pricing queue their messages as before, and the booking import works as today.

Keep the public procedures of `CGR Integration Silencer`, `CGR Integration Facade` and `CGR Booking Import`.
