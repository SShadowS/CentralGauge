codeunit 80511 "CGR Web Booking Runner"
{
    var
        RunBookingText: Text;
        ImportedInRun: Boolean;

    trigger OnRun()
    var
        WebBookingImport: Codeunit "CGR Web Booking Import";
    begin
        ImportedInRun := WebBookingImport.ImportBooking(RunBookingText);
    end;

    procedure SetRunBooking(BookingText: Text)
    begin
        RunBookingText := BookingText;
        ImportedInRun := false;
    end;

    procedure BookingAccepted(): Boolean
    begin
        exit(ImportedInRun);
    end;
}
