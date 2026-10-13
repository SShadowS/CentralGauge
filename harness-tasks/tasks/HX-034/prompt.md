# Feature 7517: Import returns from the key drop-box

Reported by the Front desk.

Customers who come back after hours leave the keys in the drop-box at the door. The drop-box app records the contract, the odometer reading and any damage the customer reported, and sends the night's returns to us in one go. Today the front desk types each of them in by hand the next morning.

Requirement:

- A new codeunit `CGR Return Import` (Rental) with `ImportReturns(Payload: Text): Integer`.
- The payload is a JSON array with one object per returned contract:

  ```json
  [
    {"contractNo": "RC1001", "returnKm": 1300, "damage": "Dent rear door"},
    {"contractNo": "RC1002", "returnKm": 2450, "damage": null},
    {"contractNo": "RC1003", "returnKm": 870, "damage": ""},
    {"contractNo": "RC1004", "returnKm": 5120}
  ]
  ```

  `returnKm` is a whole number. `damage` is the reported damage; when it is null, empty or not there at all, no damage was reported.
- Each element is returned exactly as the front desk returns a contract with `CGR Rental Mgt` (Return), with the element's return km and damage, so everything that happens on a return today happens for an imported one too.
- The function returns the number of contracts returned. An empty array returns 0.
- A payload is imported all or nothing: when any element cannot be returned, the error is raised to the caller and none of the payload's returns is kept.
