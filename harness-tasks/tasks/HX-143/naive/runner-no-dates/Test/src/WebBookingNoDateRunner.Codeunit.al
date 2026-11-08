codeunit 80515 "CGR Web Booking NoDate Runner"
{
    var
        NoDateBookingText: Text;
        NoDateAccepted: Boolean;

    trigger OnRun()
    var
        WebBookingImport: Codeunit "CGR Web Booking Import";
    begin
        NoDateAccepted := WebBookingImport.ImportBooking(NoDateBookingText);
    end;

    procedure SetNoDateBooking(BookingText: Text)
    begin
        NoDateBookingText := BookingText;
        NoDateAccepted := false;
    end;

    procedure NoDateResult(): Boolean
    begin
        exit(NoDateAccepted);
    end;
}
