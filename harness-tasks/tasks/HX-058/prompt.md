# Bug 7685: Workshop mileage file updates only some vehicles

Reported by the Workshop.

Last sprint we shipped the codeunit `CGR Mileage Import` (Fleet). The workshop sends us a file with the odometer readings it took, one line per reading in the form `<plate>;<km>`, and `ImportMileage(Readings: List of [Text]): Integer` puts them on our vehicles and returns the number of vehicles it updated.

Observed: a file with the two lines `ab-1201;15200` and `AB-1202;9100` updates vehicle AB-1202 only. The mileage of AB-1201 stays as it was, although its reading is above it.

Expected:

- A reading applies to its vehicle whatever the case of the plate in the file.
- When the file holds several readings of one vehicle, also written in different case, the last one in the file counts.
- A reading only ever raises a vehicle's mileage; a reading below the current mileage changes nothing.
- Readings of plates we do not know and malformed lines (no `;`, or a km that is not a whole number) are skipped.
- The result is the number of vehicles updated.

Reproduction:

1. Vehicles AB-1201 with mileage 15000 and AB-1202 with mileage 9000.
2. Call `ImportMileage` with the lines `ab-1201;15200` and `AB-1202;9100`.
3. It returns 1 and AB-1201 still shows 15000. Expected: it returns 2, AB-1201 shows 15200 and AB-1202 shows 9100.
