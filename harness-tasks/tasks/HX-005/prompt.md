# Task 4250: Let partner apps add rental pricing methods

Partners want to ship their own rental pricing methods, for example a flat corporate rate, in their own apps without changing Rental. Today the pricing methods are hard-wired in `CGR Rental Pricing`.

Change Rental so that:

- "CGR Pricing Method" can be extended by other apps, and every method provides its base price through an interface named "CGR Rental Price Method" with one procedure: `CalcBasePrice(Contract: Record "CGR Rental Contract"; DailyRate: Decimal): Decimal`, where DailyRate is the daily rate of the contract's vehicle.
- Daily and Weekend Package keep producing exactly the prices they produce today.
- The excess km charge stays common: it is added on top of the base price of every method, including methods added by other apps.
- The total is rounded to 0.01 once, after the excess km charge is added.
- `CGR Rental Pricing`, CalcAmount(Contract) keeps its signature and still returns the full price, and posting keeps using it.
