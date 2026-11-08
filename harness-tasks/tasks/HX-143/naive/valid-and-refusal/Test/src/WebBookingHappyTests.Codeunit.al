codeunit 80516 "CGR Web Booking Happy Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure HappyValidBookingCreatesContract()
    var
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Web Booking Happy Runner";
        BookingText: Text;
    begin
        BookingText := HX143HBooking('HX143-H1', 'HX143 Happy Valid');
        HX143HPrepare(BookingText, 'HX143 Happy Valid');
        Lib.CreateVehicle('HX143-H1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Runner.SetHappyBooking(BookingText);
        Commit();

        Assert.IsTrue(Runner.Run(), 'No error: ' + GetLastErrorText());
        Assert.IsTrue(Runner.HappyResult(), 'A valid booking returns true');
        Contract.SetRange("Customer Name", 'HX143 Happy Valid');
        Assert.AreEqual(1, Contract.Count(), 'One contract');
        Contract.FindFirst();
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'Open');
        Assert.AreEqual(20270301D, Contract."Start Date", 'Start Date');
        Assert.AreEqual(20270304D, Contract."End Date", 'End Date');
    end;

    [Test]
    procedure HappyRefusedBookingKeepsNothing()
    var
        Contract: Record "CGR Rental Contract";
        BookingError: Record "CGR Web Booking Error";
        Spy: Codeunit "CGR Channel Happy Refusal Spy";
        Runner: Codeunit "CGR Web Booking Happy Runner";
        BookingText: Text;
        Ok: Boolean;
    begin
        BookingText := HX143HBooking('HX143-H2', 'HX143 Happy Refused');
        HX143HPrepare(BookingText, 'HX143 Happy Refused');
        Lib.CreateVehicle('HX143-H2', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Runner.SetHappyBooking(BookingText);
        Spy.RefuseHappyBookings();
        Commit();

        BindSubscription(Spy);
        Ok := Runner.Run();
        UnbindSubscription(Spy);

        Assert.IsTrue(Ok, 'No error: ' + GetLastErrorText());
        Assert.IsFalse(Runner.HappyResult(), 'A refused booking returns false');
        BookingError.SetRange("Booking Text", BookingText);
        Assert.AreEqual(1, BookingError.Count(), 'One error row');
        BookingError.FindFirst();
        Assert.AreEqual(Spy.HappyRefusalText(), BookingError."Error Text", 'Refusal text');
        Contract.SetRange("Customer Name", 'HX143 Happy Refused');
        Assert.AreEqual(0, Contract.Count(), 'No contract kept');
    end;

    local procedure HX143HPrepare(BookingText: Text; CustomerName: Text[100])
    var
        Contract: Record "CGR Rental Contract";
        BookingError: Record "CGR Web Booking Error";
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        BookingError.SetRange("Booking Text", BookingText);
        BookingError.DeleteAll();
        Contract.SetRange("Customer Name", CustomerName);
        Contract.DeleteAll();
    end;

    local procedure HX143HBooking(VehicleNo: Text; CustomerName: Text) BookingText: Text
    var
        Booking: JsonObject;
    begin
        Booking.Add('vehicleNo', VehicleNo);
        Booking.Add('customer', CustomerName);
        Booking.Add('start', '2027-03-01');
        Booking.Add('end', '2027-03-04');
        Booking.WriteTo(BookingText);
    end;
}
