codeunit 86160 "HX035 Group Avail Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure SisterVehiclesCountedThere()
    var
        GroupAvailability: Codeunit "CGR Group Availability";
        Sister: Text[30];
        Before: Integer;
    begin
        WorkDate(20270301D);
        Sister := HX35SisterCompany();
        ClearHX35Vehicles(Sister);
        SetHX35OwnStop(false);
        SetHX35SisterStop(Sister, false);
        Before := GroupAvailability.AvailableVehicles(Sister);

        InsertHX35Data(Sister, 'HX035-1');

        Assert.AreEqual(Before + 3, GroupAvailability.AvailableVehicles(Sister), 'The sister company counts its own free vehicles: B, C and D');
    end;

    [Test]
    procedure OwnCompanyCounted()
    var
        GroupAvailability: Codeunit "CGR Group Availability";
        Sister: Text[30];
        Before: Integer;
    begin
        WorkDate(20270301D);
        Sister := HX35SisterCompany();
        ClearHX35Vehicles(Sister);
        SetHX35OwnStop(false);
        SetHX35SisterStop(Sister, false);
        Before := GroupAvailability.AvailableVehicles(CopyStr(CompanyName(), 1, 30));

        InsertHX35Data(Sister, 'HX035-2');

        Assert.AreEqual(Before + 1, GroupAvailability.AvailableVehicles(CopyStr(CompanyName(), 1, 30)), 'Our own company counts only A: B is checked out and C is blocked here');
    end;

    [Test]
    procedure SisterStopApplies()
    var
        GroupAvailability: Codeunit "CGR Group Availability";
        Sister: Text[30];
    begin
        WorkDate(20270301D);
        Sister := HX35SisterCompany();
        ClearHX35Vehicles(Sister);
        SetHX35OwnStop(false);
        SetHX35SisterStop(Sister, true);

        InsertHX35Data(Sister, 'HX035-3');

        Assert.AreEqual(0, GroupAvailability.AvailableVehicles(Sister), 'A sister company that has suspended rentals has no available vehicles');
    end;

    [Test]
    procedure OwnStopDoesNotApplyToSister()
    var
        GroupAvailability: Codeunit "CGR Group Availability";
        Sister: Text[30];
        Before: Integer;
    begin
        WorkDate(20270301D);
        Sister := HX35SisterCompany();
        ClearHX35Vehicles(Sister);
        SetHX35OwnStop(true);
        SetHX35SisterStop(Sister, false);
        Before := GroupAvailability.AvailableVehicles(Sister);

        InsertHX35Data(Sister, 'HX035-4');

        Assert.AreEqual(Before + 3, GroupAvailability.AvailableVehicles(Sister), 'Our rental stop does not apply to the sister company');
    end;

    [Test]
    procedure SisterOnlyVehicleCounted()
    var
        GroupAvailability: Codeunit "CGR Group Availability";
        Sister: Text[30];
        Before: Integer;
    begin
        WorkDate(20270301D);
        Sister := HX35SisterCompany();
        ClearHX35Vehicles(Sister);
        SetHX35OwnStop(false);
        SetHX35SisterStop(Sister, false);
        Before := GroupAvailability.AvailableVehicles(Sister);

        InsertHX35Vehicle(Sister, 'HX035-5D', false, false);

        Assert.AreEqual(Before + 1, GroupAvailability.AvailableVehicles(Sister), 'A vehicle that exists only in the sister company is counted there');
    end;

    [Test]
    procedure SisterWithoutSetupRowNotSuspended()
    var
        Setup: Record "CGR Setup";
        GroupAvailability: Codeunit "CGR Group Availability";
        Sister: Text[30];
        Before: Integer;
    begin
        WorkDate(20270301D);
        Sister := HX35SisterCompany();
        ClearHX35Vehicles(Sister);
        SetHX35OwnStop(false);
        Setup.ChangeCompany(Sister);
        Setup.DeleteAll();
        Before := GroupAvailability.AvailableVehicles(Sister);

        InsertHX35Vehicle(Sister, 'HX035-6E', false, false);
        InsertHX35Vehicle(CopyStr(CompanyName(), 1, 30), 'HX035-6E', true, false);

        Assert.AreEqual(Before + 1, GroupAvailability.AvailableVehicles(Sister), 'A sister company without a Setup record has not suspended rentals');
        Assert.IsTrue(Setup.IsEmpty(), 'Counting creates no Setup record in the sister company');
    end;

    local procedure InsertHX35Data(Sister: Text[30]; Prefix: Text[10])
    var
        Own: Text[30];
    begin
        Own := CopyStr(CompanyName(), 1, 30);
        InsertHX35Vehicle(Own, Prefix + 'A', false, false);
        InsertHX35Vehicle(Own, Prefix + 'B', true, false);
        InsertHX35Vehicle(Own, Prefix + 'C', false, true);
        InsertHX35Vehicle(Sister, Prefix + 'A', true, false);
        InsertHX35Vehicle(Sister, Prefix + 'B', false, false);
        InsertHX35Vehicle(Sister, Prefix + 'C', false, false);
        InsertHX35Vehicle(Sister, Prefix + 'D', false, false);
    end;

    local procedure InsertHX35Vehicle(InCompany: Text[30]; VehicleNo: Code[20]; CheckedOut: Boolean; IsBlocked: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.ChangeCompany(InCompany);
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle."Checked Out" := CheckedOut;
        Vehicle.Blocked := IsBlocked;
        Vehicle.Insert();
    end;

    local procedure ClearHX35Vehicles(Sister: Text[30])
    var
        OwnVehicle: Record "CGR Vehicle";
        SisterVehicle: Record "CGR Vehicle";
    begin
        OwnVehicle.SetFilter("No.", 'HX035-*');
        OwnVehicle.DeleteAll();
        SisterVehicle.ChangeCompany(Sister);
        SisterVehicle.SetFilter("No.", 'HX035-*');
        SisterVehicle.DeleteAll();
    end;

    local procedure SetHX35OwnStop(Suspend: Boolean)
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Suspend Rentals" := Suspend;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure SetHX35SisterStop(Sister: Text[30]; Suspend: Boolean)
    var
        Setup: Record "CGR Setup";
    begin
        Setup.ChangeCompany(Sister);
        if not Setup.Get() then begin
            Setup."Primary Key" := '';
            Setup.Insert();
        end;
        Setup."Suspend Rentals" := Suspend;
        Setup.Modify();
    end;

    local procedure HX35SisterCompany(): Text[30]
    var
        Company: Record Company;
    begin
        if Company.FindSet() then
            repeat
                if Company.Name <> CompanyName() then
                    exit(Company.Name);
            until Company.Next() = 0;
        Error('HX035 needs a second company next to %1.', CompanyName());
    end;
}
