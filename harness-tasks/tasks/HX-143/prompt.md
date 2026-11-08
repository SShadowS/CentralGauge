# Task 7318: Automated tests for the web booking import

Reported by the Channel team.

The channel manager (a partner app) sends web bookings to `CGR Web Booking Import`.`ImportBooking` and tells the booking site whether the booking was accepted. The booking site shows bookings as confirmed for which no rental contract exists.

Before anyone changes the import we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the import must behave (`CGR Web Booking Import` in Rental, procedure `ImportBooking(BookingJson: Text): Boolean`; event `OnAfterImportBooking(ContractNo: Code[20])` on `CGR Web Booking Create`; error log table `CGR Web Booking Error`):

- A valid booking (`{"vehicleNo": "...", "customer": "...", "start": "2027-03-01", "end": "2027-03-04"}`) creates one Open rental contract for that vehicle and customer, from the start date to the end date, and returns true.
- A booking that cannot be read (not JSON, a missing field, a date that is not yyyy-mm-dd) returns false, creates nothing, and writes one `CGR Web Booking Error` row with the booking text and the reason. It never raises an error.
- A booking for an unknown vehicle, or one the channel manager refuses in OnAfterImportBooking, returns false, writes one `CGR Web Booking Error` row with the booking text and that error text, and keeps nothing of the contract.
- The partner API listener has committed all of its own changes when it calls the import.
