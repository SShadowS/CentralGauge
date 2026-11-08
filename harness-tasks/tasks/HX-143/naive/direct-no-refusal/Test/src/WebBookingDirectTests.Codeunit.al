codeunit 80513 "CGR Web Booking Direct Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure DirectValidBookingCreatesContract()
    var
        Contract: Record "CGR Rental Contract";
        WebBookingImport: Codeunit "CGR Web Booking Import";
        BookingText: Text;
    begin
        BookingText := HX143DBooking('HX143-D1', 'HX143 Direct Valid', '2027-03-01', '2027-03-04');
        HX143DPrepare(BookingText, 'HX143 Direct Valid');
        Lib.CreateVehicle('HX143-D1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Commit();

        Assert.IsTrue(WebBookingImport.ImportBooking(BookingText), 'A valid booking returns true');
        Contract.SetRange("Customer Name", 'HX143 Direct Valid');
        Assert.AreEqual(1, Contract.Count(), 'One contract');
        Contract.FindFirst();
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'Open');
        Assert.AreEqual(20270301D, Contract."Start Date", 'Start Date');
        Assert.AreEqual(20270304D, Contract."End Date", 'End Date');
    end;

    [Test]
    procedure DirectBadDateReturnsFalse()
    var
        Contract: Record "CGR Rental Contract";
        WebBookingImport: Codeunit "CGR Web Booking Import";
        BookingText: Text;
    begin
        BookingText := HX143DBooking('HX143-D2', 'HX143 Direct Date', '03/04/2026', '2027-03-04');
        HX143DPrepare(BookingText, 'HX143 Direct Date');
        Lib.CreateVehicle('HX143-D2', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Commit();

        Assert.IsFalse(WebBookingImport.ImportBooking(BookingText), 'A bad date returns false');
        Assert.AreEqual(1, HX143DErrorRows(BookingText), 'One error row');
        Contract.SetRange("Customer Name", 'HX143 Direct Date');
        Assert.AreEqual(0, Contract.Count(), 'No contract');
    end;

    [Test]
    procedure DirectUnknownVehicleReturnsFalse()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        WebBookingImport: Codeunit "CGR Web Booking Import";
        BookingText: Text;
    begin
        BookingText := HX143DBooking('HX143-DGHOST', 'HX143 Direct Ghost', '2027-03-01', '2027-03-04');
        HX143DPrepare(BookingText, 'HX143 Direct Ghost');
        if Vehicle.Get('HX143-DGHOST') then
            Vehicle.Delete();
        Commit();

        Assert.IsFalse(WebBookingImport.ImportBooking(BookingText), 'An unknown vehicle returns false');
        Assert.AreEqual(1, HX143DErrorRows(BookingText), 'One error row');
        Contract.SetRange("Customer Name", 'HX143 Direct Ghost');
        Assert.AreEqual(0, Contract.Count(), 'No contract');
    end;

    local procedure HX143DPrepare(BookingText: Text; CustomerName: Text[100])
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

    local procedure HX143DBooking(VehicleNo: Text; CustomerName: Text; StartText: Text; EndText: Text) BookingText: Text
    var
        Booking: JsonObject;
    begin
        Booking.Add('vehicleNo', VehicleNo);
        Booking.Add('customer', CustomerName);
        Booking.Add('start', StartText);
        Booking.Add('end', EndText);
        Booking.WriteTo(BookingText);
    end;

    local procedure HX143DErrorRows(BookingText: Text): Integer
    var
        BookingError: Record "CGR Web Booking Error";
    begin
        BookingError.SetRange("Booking Text", BookingText);
        exit(BookingError.Count());
    end;
}
