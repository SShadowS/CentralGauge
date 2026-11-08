codeunit 80510 "CGR Web Booking Import Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure ValidBookingCreatesOneOpenContract()
    var
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Web Booking Runner";
        BookingText: Text;
        Ok: Boolean;
    begin
        BookingText := HX143Booking('HX143-V1', 'HX143 Valid Customer', '2027-03-01', '2027-03-04');
        HX143Prepare(BookingText, 'HX143 Valid Customer');
        Lib.CreateVehicle('HX143-V1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Runner.SetRunBooking(BookingText);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The import never raises: ' + GetLastErrorText());
        Assert.IsTrue(Runner.BookingAccepted(), 'A valid booking returns true');
        Contract.SetRange("Customer Name", 'HX143 Valid Customer');
        Assert.AreEqual(1, Contract.Count(), 'A valid booking creates one contract');
        Contract.FindFirst();
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'The contract is Open');
        Assert.AreEqual('HX143-V1', Contract."Vehicle No.", 'The contract is for the booked vehicle');
        Assert.AreEqual(20270301D, Contract."Start Date", 'Start Date is the booking start');
        Assert.AreEqual(20270304D, Contract."End Date", 'End Date is the booking end');
        Assert.AreEqual(0, HX143ErrorRows(BookingText), 'A valid booking writes no error row');
    end;

    [Test]
    procedure MissingFieldIsLoggedNotRaised()
    var
        Contract: Record "CGR Rental Contract";
        BookingError: Record "CGR Web Booking Error";
        Runner: Codeunit "CGR Web Booking Runner";
        Booking: JsonObject;
        BookingText: Text;
        Ok: Boolean;
    begin
        Booking.Add('vehicleNo', 'HX143-V2');
        Booking.Add('start', '2027-03-01');
        Booking.Add('end', '2027-03-04');
        Booking.WriteTo(BookingText);
        HX143Prepare(BookingText, '');
        Lib.CreateVehicle('HX143-V2', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Runner.SetRunBooking(BookingText);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'An unreadable booking never raises: ' + GetLastErrorText());
        Assert.IsFalse(Runner.BookingAccepted(), 'A booking without a customer returns false');
        Assert.AreEqual(1, HX143ErrorRows(BookingText), 'One error row with the booking text');
        BookingError.SetRange("Booking Text", BookingText);
        BookingError.FindFirst();
        Assert.IsTrue(StrPos(BookingError."Error Text", 'customer') > 0, 'The error row names the missing field: ' + BookingError."Error Text");
        Contract.SetRange("Vehicle No.", 'HX143-V2');
        Assert.AreEqual(0, Contract.Count(), 'An unreadable booking creates nothing');
    end;

    [Test]
    procedure BadDateIsLoggedNotRaised()
    var
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Web Booking Runner";
        BookingText: Text;
        Ok: Boolean;
    begin
        BookingText := HX143Booking('HX143-V3', 'HX143 Date Customer', '03/04/2026', '2027-03-04');
        HX143Prepare(BookingText, 'HX143 Date Customer');
        Lib.CreateVehicle('HX143-V3', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Runner.SetRunBooking(BookingText);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'A booking with a bad date never raises: ' + GetLastErrorText());
        Assert.IsFalse(Runner.BookingAccepted(), 'A booking with a bad date returns false');
        Assert.AreEqual(1, HX143ErrorRows(BookingText), 'One error row with the booking text');
        Contract.SetRange("Vehicle No.", 'HX143-V3');
        Assert.AreEqual(0, Contract.Count(), 'A booking with a bad date creates nothing');
    end;

    [Test]
    procedure UnknownVehicleIsLoggedAndKeepsNothing()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        BookingError: Record "CGR Web Booking Error";
        Runner: Codeunit "CGR Web Booking Runner";
        BookingText: Text;
        Ok: Boolean;
    begin
        BookingText := HX143Booking('HX143-GHOST', 'HX143 Ghost Customer', '2027-03-01', '2027-03-04');
        HX143Prepare(BookingText, 'HX143 Ghost Customer');
        if Vehicle.Get('HX143-GHOST') then
            Vehicle.Delete();
        Runner.SetRunBooking(BookingText);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'A booking for an unknown vehicle never raises: ' + GetLastErrorText());
        Assert.IsFalse(Runner.BookingAccepted(), 'A booking for an unknown vehicle returns false');
        Assert.AreEqual(1, HX143ErrorRows(BookingText), 'One error row with the booking text');
        BookingError.SetRange("Booking Text", BookingText);
        BookingError.FindFirst();
        Assert.AreNotEqual('', BookingError."Error Text", 'The error row carries the error text');
        Contract.SetRange("Customer Name", 'HX143 Ghost Customer');
        Assert.AreEqual(0, Contract.Count(), 'Nothing of the contract is kept');
    end;

    [Test]
    procedure ChannelRefusalKeepsNoContract()
    var
        Contract: Record "CGR Rental Contract";
        BookingError: Record "CGR Web Booking Error";
        Spy: Codeunit "CGR Channel Refusal Spy";
        Runner: Codeunit "CGR Web Booking Runner";
        BookingText: Text;
        Ok: Boolean;
    begin
        BookingText := HX143Booking('HX143-V5', 'HX143 Refused Customer', '2027-03-01', '2027-03-04');
        HX143Prepare(BookingText, 'HX143 Refused Customer');
        Lib.CreateVehicle('HX143-V5', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Runner.SetRunBooking(BookingText);
        Spy.RefuseEveryBooking();

        Commit();
        BindSubscription(Spy);
        Ok := Runner.Run();
        UnbindSubscription(Spy);

        Assert.IsTrue(Ok, 'A refused booking never raises: ' + GetLastErrorText());
        Assert.IsFalse(Runner.BookingAccepted(), 'A refused booking returns false');
        Assert.AreEqual(1, HX143ErrorRows(BookingText), 'One error row with the booking text');
        BookingError.SetRange("Booking Text", BookingText);
        BookingError.FindFirst();
        Assert.AreEqual(Spy.ChannelRefusalText(), BookingError."Error Text", 'The error row carries the refusal text');
        Contract.SetRange("Customer Name", 'HX143 Refused Customer');
        Assert.AreEqual(0, Contract.Count(), 'Nothing of the refused contract is kept');
    end;

    local procedure HX143Prepare(BookingText: Text; CustomerName: Text[100])
    var
        Contract: Record "CGR Rental Contract";
        BookingError: Record "CGR Web Booking Error";
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        BookingError.SetRange("Booking Text", BookingText);
        BookingError.DeleteAll();
        if CustomerName <> '' then begin
            Contract.SetRange("Customer Name", CustomerName);
            Contract.DeleteAll();
        end;
    end;

    local procedure HX143Booking(VehicleNo: Text; CustomerName: Text; StartText: Text; EndText: Text) BookingText: Text
    var
        Booking: JsonObject;
    begin
        Booking.Add('vehicleNo', VehicleNo);
        Booking.Add('customer', CustomerName);
        Booking.Add('start', StartText);
        Booking.Add('end', EndText);
        Booking.WriteTo(BookingText);
    end;

    local procedure HX143ErrorRows(BookingText: Text): Integer
    var
        BookingError: Record "CGR Web Booking Error";
    begin
        BookingError.SetRange("Booking Text", BookingText);
        exit(BookingError.Count());
    end;
}
