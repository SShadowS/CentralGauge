codeunit 86620 "HX058 Mileage Import Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure LowerCasePlateApplied()
    var
        Readings: List of [Text];
    begin
        Prepare();
        CreateVehicle('HX058-1', 1000);
        Readings.Add('hx058-1;1500');

        Assert.AreEqual(1, Import(Readings), 'A lower-case reading updates its vehicle');
        AssertMileage('HX058-1', 1500);
    end;

    [Test]
    procedure MixedCasePlateApplied()
    var
        Readings: List of [Text];
    begin
        Prepare();
        CreateVehicle('HX058-2', 1000);
        Readings.Add('Hx058-2;1600');

        Assert.AreEqual(1, Import(Readings), 'A mixed-case reading updates its vehicle');
        AssertMileage('HX058-2', 1600);
    end;

    [Test]
    procedure UpperCasePlateAsToday()
    var
        Readings: List of [Text];
    begin
        Prepare();
        CreateVehicle('HX058-3', 1000);
        Readings.Add('HX058-3;1700');

        Assert.AreEqual(1, Import(Readings), 'An upper-case reading updates its vehicle');
        AssertMileage('HX058-3', 1700);
    end;

    [Test]
    procedure LastReadingAnyCaseWins()
    var
        Readings: List of [Text];
    begin
        Prepare();
        CreateVehicle('HX058-4', 1000);
        Readings.Add('hx058-4;1200');
        Readings.Add('HX058-4;1300');

        Assert.AreEqual(1, Import(Readings), 'Two readings of one vehicle update one vehicle');
        AssertMileage('HX058-4', 1300);
    end;

    [Test]
    procedure LastReadingWinsWhenLower()
    var
        Readings: List of [Text];
    begin
        Prepare();
        CreateVehicle('HX058-5', 1000);
        Readings.Add('HX058-5;1300');
        Readings.Add('hx058-5;1200');

        Assert.AreEqual(1, Import(Readings), 'Two readings of one vehicle update one vehicle');
        AssertMileage('HX058-5', 1200);
    end;

    [Test]
    procedure LowerReadingIgnored()
    var
        Readings: List of [Text];
    begin
        Prepare();
        CreateVehicle('HX058-6', 2000);
        Readings.Add('hx058-6;1500');

        Assert.AreEqual(0, Import(Readings), 'A reading below the mileage updates nothing');
        AssertMileage('HX058-6', 2000);
    end;

    [Test]
    procedure UnknownAndMalformedSkipped()
    var
        Vehicle: Record "CGR Vehicle";
        Readings: List of [Text];
    begin
        Prepare();
        if Vehicle.Get('HX058-NONE') then
            Vehicle.Delete();
        CreateVehicle('HX058-7', 1000);
        Readings.Add('HX058-7;1100');
        Readings.Add('hx058-7');
        Readings.Add('hx058-7;abc');
        Readings.Add('hx058-none;100');

        Assert.AreEqual(1, Import(Readings), 'Only the well-formed reading of a known vehicle counts');
        AssertMileage('HX058-7', 1100);
        Assert.IsFalse(Vehicle.Get('HX058-NONE'), 'No vehicle is created for an unknown plate');
    end;

    local procedure Import(Readings: List of [Text]): Integer
    var
        Runner: Codeunit "HX058 Import Runner";
        Ok: Boolean;
    begin
        Commit();
        Runner.SetReadings(Readings);
        Ok := Runner.Run();
        Assert.IsTrue(Ok, StrSubstNo('The import succeeds: %1', GetLastErrorText()));
        exit(Runner.UpdatedCount());
    end;

    local procedure AssertMileage(VehicleNo: Code[20]; Expected: Integer)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Assert.AreEqual(Expected, Vehicle.Mileage, StrSubstNo('Mileage of %1', VehicleNo));
    end;

    local procedure CreateVehicle(VehicleNo: Code[20]; Mileage: Integer)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := Mileage;
        Vehicle.Insert();
    end;

    local procedure Prepare()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup.Modify();
        SessionContext.Reset();
    end;
}
