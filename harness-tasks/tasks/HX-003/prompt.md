# Feature 4203: Keep vehicles that are due for service off the road

The workshop wants vehicles that have reached their service interval kept away from new rentals until they have been serviced.

A vehicle is due for service when its mileage has reached the next service km that its maintenance strategy gives for the mileage at its last service ("Last Service Km"). Default vehicles go 15,000 km between services and Heavy Duty vehicles 5,000 km; other apps can add strategies.

- Checking out a rental contract for a vehicle that is due for service fails with the error "Vehicle <No.> is due for service."
- Swapping a checked-out contract to a vehicle that is due for service fails with the same error.
- The fleet availability check (`CGR Fleet Mgt`, IsAvailable) reports a vehicle that is due for service as not available.
- This is a safety rule: extensions that customize vehicle availability cannot make a vehicle that is due for service available, for checkouts or swaps. For vehicles that are not due, their customizations keep working as today.
