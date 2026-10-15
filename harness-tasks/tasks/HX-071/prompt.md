# Bug 7776: Damages the insurer refuses cannot be registered at all

Reported by the Fleet desk.

Last sprint we shipped insured damages in Fleet. `CGR Damage Entry` got two fields, 6 "Insurer Pending" (Boolean) and 7 "Insurer Message" (Text[250]). The new codeunit `CGR Insurer Check` raises the integration event `OnCheckInsuredDamage(VehicleNo: Code[20]; Description: Text[100])`, to which insurer apps subscribe; an insurer app refuses a damage by raising an error. `CGR Damage Mgt` got `RegisterInsuredDamage(VehicleNo: Code[20]; Description: Text[100]): Integer`, which the desk uses instead of `RegisterDamage` for insured vehicles.

Observed: registering a damage that the insurer app refuses fails with the error 'An error occurred and the transaction is stopped. Contact your administrator or partner for further assistance.', and nothing is stored.

Expected:

- Insurer apps check every insured damage once, with its vehicle number and description, before the damage is stored.
- A damage the insurer accepts is registered the way `RegisterDamage` registers a damage: a damage entry for the vehicle with the description, Reported On the work date and not repaired; the vehicle blocked with one more open damage; `OnAfterDamageRegistered` raised. Its Insurer Pending is false and its Insurer Message is empty. The same applies when no insurer app is installed.
- A damage the insurer refuses is registered the same way, with Insurer Pending true and the insurer's error text in Insurer Message (its first 250 characters when the text is longer).
- What an insurer app writes during a check it accepts is kept; what it writes during a check it refuses is not.
- `RegisterInsuredDamage` returns the Entry No. of the stored damage entry.
- Registering commits nothing: when the caller's transaction fails after `RegisterInsuredDamage` returned, no damage entry of that registration is kept and the vehicle is unchanged.
- `RegisterDamage` and `RepairDamage` work as today; `RegisterDamage` runs no insurer check.

Damages are registered for vehicles of the fleet, by callers that have no unsaved changes of their own (the desk registers from a fresh screen). These rules do not cover what an insurer app wrote during an accepted check when the caller's transaction fails afterwards.

Keep the signatures of `RegisterInsuredDamage`, `RegisterDamage`, `RepairDamage` and of everything in `CGR Insurer Check`.

Reproduction:

1. Vehicle V-12 exists, is not blocked and has no damage entries.
2. An insurer app subscribed to `OnCheckInsuredDamage` raises the error `Not covered.` for V-12.
3. Call `RegisterInsuredDamage('V-12', 'Dent')` from a fresh screen.
4. The call fails with 'An error occurred and the transaction is stopped. Contact your administrator or partner for further assistance.' V-12 has no damage entry and is not blocked.
5. Expected: the call returns the new entry's Entry No.; the entry has Insurer Pending true and Insurer Message `Not covered.`; V-12 is blocked with Open Damages 1.
