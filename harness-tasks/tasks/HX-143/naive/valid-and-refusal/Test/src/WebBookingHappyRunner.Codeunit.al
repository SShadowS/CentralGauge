codeunit 80517 "CGR Web Booking Happy Runner"
{
    var
        HappyBookingText: Text;
        HappyAccepted: Boolean;

    trigger OnRun()
    var
        WebBookingImport: Codeunit "CGR Web Booking Import";
    begin
        HappyAccepted := WebBookingImport.ImportBooking(HappyBookingText);
    end;

    procedure SetHappyBooking(BookingText: Text)
    begin
        HappyBookingText := BookingText;
        HappyAccepted := false;
    end;

    procedure HappyResult(): Boolean
    begin
        exit(HappyAccepted);
    end;
}
