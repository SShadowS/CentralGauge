# Task 7559: The rental stop moves to Core

Reported by the Platform team.

Whether rentals are suspended is worked out by Rental's availability subscriber in `CGR Rental Fleet Subscribers`, which reads `CGR Setup` itself. Other apps need to ask the same question, and we want Core to answer it.

Requirement:

- Add to `CGR Session Context` (Core) the procedure `RentalsSuspended(): Boolean`. It returns true when "Suspend Rentals" is set in `CGR Setup` and false otherwise, also when there is no `CGR Setup` record.
- The availability subscriber in `CGR Rental Fleet Subscribers` uses RentalsSuspended instead of reading `CGR Setup` itself.
- This is a clean-up only. Asking whether rentals are suspended changes no data. Checkout and vehicle availability results stay exactly as they are today, and so does everything `CGR Session Context` returns.
