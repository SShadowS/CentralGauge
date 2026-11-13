# Task 5167: Write the owner ledger file straight into a stream

Requested by Reporting.

Vehicle owners get a file with the rental ledger entries of their vehicle for a period. `CGR Owner Ledger Export`.`BuildOwnerLedgerText` (Reporting) builds the whole file as one Text, and on long periods the export runs into text limits and memory. Write the file straight into a stream instead.

The new structure:

- Add `procedure WriteOwnerLedgerFile(VehicleNo: Code[20]; FromDate: Date; ToDate: Date; var OwnerFile: Record "CGR Owner Ledger File")` to `CGR Owner Ledger Export`. The caller has already inserted OwnerFile. WriteOwnerLedgerFile writes the file into OwnerFile.Content, and the caller reads the file back from Content.
- Remove `BuildOwnerLedgerText`.

Everything else stays as it is today: the file holds, byte for byte, the lines BuildOwnerLedgerText builds today, line ends included. The owners' systems read the file as UTF-8, and customer names with æ, ø and å arrive intact.
