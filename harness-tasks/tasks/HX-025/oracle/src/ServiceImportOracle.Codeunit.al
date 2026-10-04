codeunit 85960 "HX025 Service Import Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure DayFirstDateImported()
    var
        Vehicle: Record "CGR Vehicle";
        ServiceImport: Codeunit "CGR Service Import";
    begin
        WorkDate(20270401D);
        CreateHX25Vehicle('HX025-V01', 15000, 20270115D, 9000);

        Assert.AreEqual(1, ServiceImport.ImportServiceRecords('[' + HX25ServiceRecord('HX025-V01', '05.03.2027', 12000) + ']'), 'One record imported');
        Vehicle.Get('HX025-V01');
        Assert.AreEqual(20270305D, Vehicle."Last Service Date", '05.03.2027 is 5 March 2027');
        Assert.AreEqual(12000, Vehicle."Last Service Km", 'Service km recorded');
    end;

    [Test]
    procedure DayAboveTwelveImported()
    var
        Vehicle: Record "CGR Vehicle";
        ServiceImport: Codeunit "CGR Service Import";
    begin
        WorkDate(20270401D);
        CreateHX25Vehicle('HX025-V02', 15000, 0D, 0);

        Assert.AreEqual(1, ServiceImport.ImportServiceRecords('[' + HX25ServiceRecord('HX025-V02', '13.03.2027', 12000) + ']'), 'A record dated the 13th is imported');
        Vehicle.Get('HX025-V02');
        Assert.AreEqual(20270313D, Vehicle."Last Service Date", '13.03.2027 is 13 March 2027');
        Assert.AreEqual(12000, Vehicle."Last Service Km", 'Service km recorded');
    end;

    [Test]
    procedure OlderRecordSkipped()
    var
        Vehicle: Record "CGR Vehicle";
        ServiceImport: Codeunit "CGR Service Import";
    begin
        WorkDate(20270401D);
        CreateHX25Vehicle('HX025-V03', 15000, 20270310D, 11000);

        Assert.AreEqual(0, ServiceImport.ImportServiceRecords('[' + HX25ServiceRecord('HX025-V03', '05.03.2027', 10500) + ']'), 'A record dated before the last service is not counted');
        Vehicle.Get('HX025-V03');
        Assert.AreEqual(20270310D, Vehicle."Last Service Date", 'Last service date unchanged');
        Assert.AreEqual(11000, Vehicle."Last Service Km", 'Last service km unchanged');
    end;

    [Test]
    procedure SameDateCounts()
    var
        Vehicle: Record "CGR Vehicle";
        ServiceImport: Codeunit "CGR Service Import";
    begin
        WorkDate(20270401D);
        CreateHX25Vehicle('HX025-V04', 15000, 20270310D, 11000);

        Assert.AreEqual(1, ServiceImport.ImportServiceRecords('[' + HX25ServiceRecord('HX025-V04', '10.03.2027', 11500) + ']'), 'A record on the last service date is imported');
        Vehicle.Get('HX025-V04');
        Assert.AreEqual(20270310D, Vehicle."Last Service Date", '10.03.2027 is 10 March 2027');
        Assert.AreEqual(11500, Vehicle."Last Service Km", 'Service km recorded');
    end;

    [Test]
    procedure LateOlderResendKeepsNewer()
    var
        Vehicle: Record "CGR Vehicle";
        ServiceImport: Codeunit "CGR Service Import";
    begin
        WorkDate(20270401D);
        CreateHX25Vehicle('HX025-V05', 15000, 0D, 0);

        Assert.AreEqual(1, ServiceImport.ImportServiceRecords('[' + HX25ServiceRecord('HX025-V05', '20.03.2027', 14000) + ',' + HX25ServiceRecord('HX025-V05', '05.03.2027', 12000) + ']'), 'Only the newer service is imported');
        Vehicle.Get('HX025-V05');
        Assert.AreEqual(20270320D, Vehicle."Last Service Date", 'The newer service stays the last one');
        Assert.AreEqual(14000, Vehicle."Last Service Km", 'The newer service km stays');
    end;

    [Test]
    procedure LateOlderResendHigherKm()
    var
        Vehicle: Record "CGR Vehicle";
        ServiceImport: Codeunit "CGR Service Import";
    begin
        WorkDate(20270401D);
        CreateHX25Vehicle('HX025-V06', 15000, 0D, 0);

        Assert.AreEqual(1, ServiceImport.ImportServiceRecords('[' + HX25ServiceRecord('HX025-V06', '20.03.2027', 12000) + ',' + HX25ServiceRecord('HX025-V06', '05.03.2027', 14000) + ']'), 'Only the newer service is imported');
        Vehicle.Get('HX025-V06');
        Assert.AreEqual(20270320D, Vehicle."Last Service Date", 'The newer service stays the last one');
        Assert.AreEqual(12000, Vehicle."Last Service Km", 'The newer service km stays');
    end;

    [Test]
    procedure KmAboveMileageSkipped()
    var
        Vehicle: Record "CGR Vehicle";
        ServiceImport: Codeunit "CGR Service Import";
    begin
        WorkDate(20270401D);
        CreateHX25Vehicle('HX025-V07A', 15000, 0D, 0);
        CreateHX25Vehicle('HX025-V07B', 15000, 0D, 0);

        Assert.AreEqual(1, ServiceImport.ImportServiceRecords('[' + HX25ServiceRecord('HX025-V07A', '05.03.2027', 15001) + ',' + HX25ServiceRecord('HX025-V07B', '05.03.2027', 15000) + ']'), 'Only the record within the mileage is imported');
        Vehicle.Get('HX025-V07A');
        Assert.AreEqual(0, Vehicle."Last Service Km", 'Km above the mileage: vehicle unchanged');
        Assert.AreEqual(0D, Vehicle."Last Service Date", 'Km above the mileage: no service date');
        Vehicle.Get('HX025-V07B');
        Assert.AreEqual(15000, Vehicle."Last Service Km", 'Km equal to the mileage is imported');
    end;

    [Test]
    procedure UnknownVehicleSkipped()
    var
        Vehicle: Record "CGR Vehicle";
        ServiceImport: Codeunit "CGR Service Import";
    begin
        WorkDate(20270401D);
        if Vehicle.Get('HX025-NONE') then
            Vehicle.Delete();
        CreateHX25Vehicle('HX025-V08', 15000, 0D, 0);

        Assert.AreEqual(1, ServiceImport.ImportServiceRecords('[' + HX25ServiceRecord('HX025-NONE', '05.03.2027', 100) + ',' + HX25ServiceRecord('HX025-V08', '05.03.2027', 5000) + ']'), 'The unknown vehicle is skipped, the next record imported');
        Assert.IsFalse(Vehicle.Get('HX025-NONE'), 'No vehicle created for an unknown number');
        Vehicle.Get('HX025-V08');
        Assert.AreEqual(5000, Vehicle."Last Service Km", 'Record after the unknown vehicle imported');
    end;

    [Test]
    procedure ExtensionsNotifiedPerRecord()
    var
        ServiceImport: Codeunit "CGR Service Import";
        ServiceSpy: Codeunit "HX025 Service Spy";
        Imported: Integer;
    begin
        WorkDate(20270401D);
        CreateHX25Vehicle('HX025-V09A', 15000, 0D, 0);
        CreateHX25Vehicle('HX025-V09B', 15000, 20270320D, 8000);
        CreateHX25Vehicle('HX025-V09C', 15000, 0D, 0);
        BindSubscription(ServiceSpy);

        Imported := ServiceImport.ImportServiceRecords('[' + HX25ServiceRecord('HX025-V09A', '13.03.2027', 5000) + ',' + HX25ServiceRecord('HX025-V09B', '13.03.2027', 9000) + ',' + HX25ServiceRecord('HX025-V09C', '05.03.2027', 4000) + ']');
        UnbindSubscription(ServiceSpy);

        Assert.AreEqual(2, Imported, 'Two of three records imported');
        Assert.AreEqual(2, ServiceSpy.NotifiedCount(), 'Extensions notified once per imported record');
    end;

    local procedure CreateHX25Vehicle(VehicleNo: Code[20]; Mileage: Integer; LastServiceDate: Date; LastServiceKm: Integer)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := Mileage;
        Vehicle."Last Service Date" := LastServiceDate;
        Vehicle."Last Service Km" := LastServiceKm;
        Vehicle.Insert();
    end;

    local procedure HX25ServiceRecord(VehicleNo: Code[20]; DateText: Text; ServiceKm: Integer): Text
    begin
        exit(StrSubstNo('{"vehicleNo": "%1", "serviceDate": "%2", "serviceKm": %3}', VehicleNo, DateText, Format(ServiceKm, 0, 9)));
    end;
}
