codeunit 80514 "CGR Web Booking NoDate Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure NoDateValidBookingAccepted()
    var
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Web Booking NoDate Runner";
        BookingText: Text;
    begin
        BookingText := HX143NBooking('HX143-N1', 'HX143 NoDate Valid', true);
        HX143NPrepare(BookingText, 'HX143 NoDate Valid');
        Lib.CreateVehicle('HX143-N1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Runner.SetNoDateBooking(BookingText);
        Commit();

        Assert.IsTrue(Runner.Run(), 'No error: ' + GetLastErrorText());
        Assert.IsTrue(Runner.NoDateResult(), 'A valid booking returns true');
        Contract.SetRange("Customer Name", 'HX143 NoDate Valid');
        Assert.AreEqual(1, Contract.Count(), 'One contract');
        Contract.FindFirst();
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'Open');
    end;

    [Test]
    procedure NoDateMissingCustomerLogged()
    var
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Web Booking NoDate Runner";
        BookingText: Text;
    begin
        BookingText := HX143NBooking('HX143-N2', '', false);
        HX143NPrepare(BookingText, '');
        Lib.CreateVehicle('HX143-N2', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Runner.SetNoDateBooking(BookingText);
        Commit();

        Assert.IsTrue(Runner.Run(), 'No error: ' + GetLastErrorText());
        Assert.IsFalse(Runner.NoDateResult(), 'A booking without customer returns false');
        Assert.AreEqual(1, HX143NErrorRows(BookingText), 'One error row');
        Contract.SetRange("Vehicle No.", 'HX143-N2');
        Assert.AreEqual(0, Contract.Count(), 'No contract');
    end;

    [Test]
    procedure NoDateUnknownVehicleLogged()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Web Booking NoDate Runner";
        BookingText: Text;
    begin
        BookingText := HX143NBooking('HX143-NGHOST', 'HX143 NoDate Ghost', true);
        HX143NPrepare(BookingText, 'HX143 NoDate Ghost');
        if Vehicle.Get('HX143-NGHOST') then
            Vehicle.Delete();
        Runner.SetNoDateBooking(BookingText);
        Commit();

        Assert.IsTrue(Runner.Run(), 'No error: ' + GetLastErrorText());
        Assert.IsFalse(Runner.NoDateResult(), 'An unknown vehicle returns false');
        Assert.AreEqual(1, HX143NErrorRows(BookingText), 'One error row');
        Contract.SetRange("Customer Name", 'HX143 NoDate Ghost');
        Assert.AreEqual(0, Contract.Count(), 'No contract');
    end;

    local procedure HX143NPrepare(BookingText: Text; CustomerName: Text[100])
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

    local procedure HX143NBooking(VehicleNo: Text; CustomerName: Text; WithCustomer: Boolean) BookingText: Text
    var
        Booking: JsonObject;
    begin
        Booking.Add('vehicleNo', VehicleNo);
        if WithCustomer then
            Booking.Add('customer', CustomerName);
        Booking.Add('start', '2027-03-01');
        Booking.Add('end', '2027-03-04');
        Booking.WriteTo(BookingText);
    end;

    local procedure HX143NErrorRows(BookingText: Text): Integer
    var
        BookingError: Record "CGR Web Booking Error";
    begin
        BookingError.SetRange("Booking Text", BookingText);
        exit(BookingError.Count());
    end;
}
