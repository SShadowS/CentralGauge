# Bug 7454: Imported workshop services land on the wrong date

Reported by Workshop, Aarhus.

Last sprint we shipped the codeunit `CGR Service Import` (Fleet). The workshop portal sends the services it has carried out as a JSON array, and `ImportServiceRecords(Payload: Text): Integer` registers them on our vehicles:

```json
[{"vehicleNo": "V-1001", "serviceDate": "05.03.2027", "serviceKm": 12000}]
```

Observed since go-live:

- A service the portal sent as 05.03.2027 shows on the vehicle with "Last Service Date" 3 May 2027.
- A service dated 13.03.2027 was not imported at all.
- The portal resent a service from 05.03.2027 after the same vehicle's service of 20.03.2027 had been imported. The vehicle now shows the older service as its last one.

Expected:

- The portal's dates are day.month.year: 05.03.2027 is 5 March 2027, 13.03.2027 is 13 March 2027.
- A record whose service date is before the vehicle's "Last Service Date" changes nothing on the vehicle and is not counted. A record dated on the vehicle's "Last Service Date" is imported.
- Everything else stays as it is today: records for unknown vehicles and records whose service km is above the vehicle's mileage are skipped, every imported record is registered as a service like a manual registration (extensions that react to registered services see each one), and the function returns the number of records imported.

Reproduction:

1. Vehicle V-1001 with mileage 15000 and no service registered yet.
2. Call `ImportServiceRecords` with the payload above. It returns 1, but the vehicle's "Last Service Date" is 2027-05-03; expected 2027-03-05.
