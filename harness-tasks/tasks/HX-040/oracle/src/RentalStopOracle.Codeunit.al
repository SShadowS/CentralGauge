codeunit 86260 "HX040 Rental Stop Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure RentalsSuspendedFollowsSetup()
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        InitSetup();

        Assert.IsFalse(SessionContext.RentalsSuspended(), 'Rentals are not suspended while the stop is off');
        SetStop(true);
        Assert.IsTrue(SessionContext.RentalsSuspended(), 'Rentals are suspended once the stop is set in Setup');
    end;

    [Test]
    procedure StopAppliesAfterSetupLoaded()
    var
        Cached: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
        RentalMgt: Codeunit "CGR Rental Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup();
        InitVehicle('HX040-2', false);
        ContractNo := RentalMgt.CreateContract('HX040-2', 'HX040 Customer', 20270301D, 20270303D);
        SessionContext.GetSetup(Cached);
        Assert.IsFalse(Cached."Suspend Rentals", 'The session loaded Setup while the stop was off');

        SetStop(true);
        Assert.IsFalse(FleetMgt.IsAvailable('HX040-2'), 'A stop set after the session loaded Setup makes the vehicle unavailable');
        asserterror RentalMgt.CheckOut(ContractNo);
        Assert.ExpectedError('Vehicle HX040-2 is not available.');
    end;

    [Test]
    procedure LiftedStopAppliesAtOnce()
    var
        Cached: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        InitVehicle('HX040-3', false);
        SetStop(true);
        SessionContext.GetSetup(Cached);
        Assert.IsTrue(Cached."Suspend Rentals", 'The session loaded Setup while the stop was on');

        SetStop(false);
        Assert.IsTrue(FleetMgt.IsAvailable('HX040-3'), 'A lifted stop makes the vehicle available at once');
    end;

    [Test]
    procedure AskingKeepsSessionSetup()
    var
        Setup: Record "CGR Setup";
        Cached: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        AmountRounding: Codeunit "CGR Amount Rounding";
    begin
        WorkDate(20270301D);
        InitSetup();
        InitVehicle('HX040-4', false);
        SessionContext.GetSetup(Cached);
        Assert.AreEqual(0.01, Cached."Amount Rounding Precision", 'The session loaded Setup with precision 0.01');

        Setup.Get();
        Setup."Amount Rounding Precision" := 0.05;
        Setup.Modify();
        Assert.IsTrue(FleetMgt.IsAvailable('HX040-4'), 'The vehicle is available while the stop is off');
        Assert.AreEqual(0.01, AmountRounding.Precision(), 'Asking about the stop keeps the Setup the session loaded');

        SessionContext.RefreshSetup();
        Assert.AreEqual(0.05, AmountRounding.Precision(), 'RefreshSetup reloads Setup');
    end;

    [Test]
    procedure NoSetupRowNotSuspended()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        InitVehicle('HX040-5', false);
        Setup.DeleteAll();

        Assert.IsFalse(SessionContext.RentalsSuspended(), 'Without a Setup record rentals are not suspended');
        Assert.IsTrue(FleetMgt.IsAvailable('HX040-5'), 'Without a Setup record the vehicle is available');
        Assert.IsTrue(Setup.IsEmpty(), 'Asking whether rentals are suspended creates no Setup record');
    end;

    [Test]
    procedure BlockedVehicleStillUnavailable()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        InitVehicle('HX040-6', true);
        InitVehicle('HX040-7', false);

        Assert.IsFalse(FleetMgt.IsAvailable('HX040-6'), 'A blocked vehicle is not available while the stop is off');
        Assert.IsTrue(FleetMgt.IsAvailable('HX040-7'), 'An unblocked vehicle is available while the stop is off');
    end;

    [Test]
    procedure StopAppliesThroughAvailability()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        InitVehicle('HX040-8', false);

        SetStop(true);
        Assert.IsFalse(FleetMgt.IsAvailable('HX040-8'), 'A vehicle is not available while rentals are suspended');
    end;

    local procedure InitSetup()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := 3;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure SetStop(Suspend: Boolean)
    var
        Setup: Record "CGR Setup";
    begin
        Setup.Get();
        Setup."Suspend Rentals" := Suspend;
        Setup.Modify();
    end;

    local procedure InitVehicle(VehicleNo: Code[20]; IsBlocked: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle.Strategy := Enum::"CGR Maintenance Strategy"::Default;
        Vehicle.Blocked := IsBlocked;
        Vehicle.Insert();
    end;
}
