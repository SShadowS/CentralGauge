// Every procedure sets its own WorkDate and Setup (rental stop off) and uses its own vehicles HX074-<row><x>,
// cleaned first with their contracts. Calls that may raise run through the desk runner after Commit().
// The lending partner is bound only where a row says so, never together with the rental stop.
codeunit 86940 "HX074 Availability Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure FreeVehicleAvailable()
    var
        Runner: Codeunit "HX074 Desk Runner";
        Ok: Boolean;
    begin
        HX74Prepare();
        HX74Vehicle('HX074-1A', 1000, false);
        Runner.HX74SetVehicleCheck('HX074-1A');

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, StrSubstNo('A free vehicle is available: %1', GetLastErrorText()));
    end;

    [Test]
    procedure BlockedVehicleNotAvailable()
    var
        Runner: Codeunit "HX074 Desk Runner";
        Ok: Boolean;
    begin
        HX74Prepare();
        HX74Vehicle('HX074-2A', 1000, true);
        Runner.HX74SetVehicleCheck('HX074-2A');

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A blocked vehicle is not available');
        Assert.AreEqual('Vehicle HX074-2A is not available.', GetLastErrorText(), 'The not-available error');
    end;

    [Test]
    procedure UnknownVehicleNotAvailable()
    var
        Runner: Codeunit "HX074 Desk Runner";
        Ok: Boolean;
    begin
        HX74Prepare();
        HX74RemoveVehicle('HX074-NONE');
        Runner.HX74SetVehicleCheck('HX074-NONE');

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A vehicle that does not exist is not available');
        Assert.AreEqual('Vehicle HX074-NONE is not available.', GetLastErrorText(), 'The not-available error, not the not-found error');
    end;

    [Test]
    procedure SwapRefusedWhenRentalsStopped()
    var
        Setup: Record "CGR Setup";
        Runner: Codeunit "HX074 Desk Runner";
        ContractNo: Code[20];
        ErrorText: Text;
        Ok: Boolean;
    begin
        HX74Prepare();
        HX74Vehicle('HX074-4A', 1000, false);
        HX74Vehicle('HX074-4B', 2500, false);
        ContractNo := HX74CheckedOutContract('HX074-4A');
        Setup.Get();
        Setup."Suspend Rentals" := true;
        Setup.Modify();
        Runner.HX74SetSwap(ContractNo, 'HX074-4B');

        Commit();
        Ok := Runner.Run();
        ErrorText := GetLastErrorText();
        HX74Prepare();

        Assert.IsFalse(Ok, 'No swap while rentals are suspended');
        Assert.AreEqual('Vehicle HX074-4B is not available.', ErrorText, 'The not-available error for the new vehicle');
        HX74AssertContract(ContractNo, 'HX074-4A', 1000);
        HX74AssertCheckedOut('HX074-4A', true);
        HX74AssertCheckedOut('HX074-4B', false);
    end;

    [Test]
    procedure SwapAcceptsLentBlockedVehicle()
    var
        Partner: Codeunit "HX074 Lending Partner";
        Runner: Codeunit "HX074 Desk Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        HX74Prepare();
        HX74Vehicle('HX074-5A', 1000, false);
        HX74Vehicle('HX074-5B', 2500, true);
        ContractNo := HX74CheckedOutContract('HX074-5A');
        Partner.HX74Decide('HX074-5B', true);
        BindSubscription(Partner);
        Runner.HX74SetSwap(ContractNo, 'HX074-5B');

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, StrSubstNo('A blocked vehicle an extension reports available can be swapped to: %1', GetLastErrorText()));
        HX74AssertContract(ContractNo, 'HX074-5B', 2500);
        HX74AssertCheckedOut('HX074-5B', true);
        HX74AssertCheckedOut('HX074-5A', false);
    end;

    [Test]
    procedure SwapRefusedByPartner()
    var
        Partner: Codeunit "HX074 Lending Partner";
        Runner: Codeunit "HX074 Desk Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        HX74Prepare();
        HX74Vehicle('HX074-6A', 1000, false);
        HX74Vehicle('HX074-6B', 2500, false);
        ContractNo := HX74CheckedOutContract('HX074-6A');
        Partner.HX74Decide('HX074-6B', false);
        BindSubscription(Partner);
        Runner.HX74SetSwap(ContractNo, 'HX074-6B');

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A free vehicle an extension reports not available is refused');
        Assert.AreEqual('Vehicle HX074-6B is not available.', GetLastErrorText(), 'The not-available error for the new vehicle');
        HX74AssertContract(ContractNo, 'HX074-6A', 1000);
        HX74AssertCheckedOut('HX074-6A', true);
        HX74AssertCheckedOut('HX074-6B', false);
    end;

    [Test]
    procedure SwapUnknownVehicleNotFound()
    var
        Runner: Codeunit "HX074 Desk Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        HX74Prepare();
        HX74Vehicle('HX074-7A', 1000, false);
        HX74RemoveVehicle('HX074-NONE');
        ContractNo := HX74CheckedOutContract('HX074-7A');
        Runner.HX74SetSwap(ContractNo, 'HX074-NONE');

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A new vehicle that does not exist is refused');
        Assert.AreEqual('The CGR Vehicle does not exist. Identification fields and values: No.=''HX074-NONE''', GetLastErrorText(), 'The platform''s not-found error comes before availability');
        HX74AssertContract(ContractNo, 'HX074-7A', 1000);
    end;

    [Test]
    procedure SwapOpenContractStatusFirst()
    var
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "HX074 Desk Runner";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        HX74Prepare();
        HX74Vehicle('HX074-8A', 1000, false);
        HX74Vehicle('HX074-8B', 2500, true);
        ContractNo := RentalMgt.CreateContract('HX074-8A', 'HX074 Customer', 20270301D, 20270303D);
        Runner.HX74SetSwap(ContractNo, 'HX074-8B');

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A contract that is not checked out cannot swap');
        Assert.AreEqual(StrSubstNo('Rental contract %1 must have status %2.', ContractNo, Contract.Status::"Checked Out"), GetLastErrorText(), 'The status error comes before availability');
    end;

    [Test]
    procedure SwapBlockedVehicleRefused()
    var
        Vehicle: Record "CGR Vehicle";
        Runner: Codeunit "HX074 Desk Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        HX74Prepare();
        HX74Vehicle('HX074-9A', 1000, false);
        HX74Vehicle('HX074-9B', 2500, true);
        ContractNo := HX74CheckedOutContract('HX074-9A');
        Vehicle.Get('HX074-9B');
        Assert.IsTrue(Vehicle.Blocked, 'Precondition: HX074-9B is blocked');
        Runner.HX74SetSwap(ContractNo, 'HX074-9B');

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A blocked vehicle is refused');
        Assert.AreEqual('Vehicle HX074-9B is not available.', GetLastErrorText(), 'The not-available error for the new vehicle');
        HX74AssertContract(ContractNo, 'HX074-9A', 1000);
        HX74AssertCheckedOut('HX074-9B', false);
    end;

    [Test]
    procedure CheckOutBlockedRefused()
    var
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "HX074 Desk Runner";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        HX74Prepare();
        HX74Vehicle('HX074-10C', 1000, true);
        ContractNo := RentalMgt.CreateContract('HX074-10C', 'HX074 Customer', 20270301D, 20270303D);
        Runner.HX74SetCheckOut(ContractNo);

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A blocked vehicle cannot be checked out');
        Assert.AreEqual('Vehicle HX074-10C is not available.', GetLastErrorText(), 'The not-available error');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'The contract stays open');
        HX74AssertCheckedOut('HX074-10C', false);
    end;

    [Test]
    procedure CheckOutLentBlockedVehicle()
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        Partner: Codeunit "HX074 Lending Partner";
        Runner: Codeunit "HX074 Desk Runner";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        HX74Prepare();
        HX74Vehicle('HX074-11C', 1000, true);
        ContractNo := RentalMgt.CreateContract('HX074-11C', 'HX074 Customer', 20270301D, 20270303D);
        Vehicle.Get('HX074-11C');
        Assert.IsTrue(Vehicle.Blocked, 'Precondition: HX074-11C is blocked');
        Assert.IsFalse(Vehicle."Checked Out", 'Precondition: HX074-11C is not checked out');
        Partner.HX74Decide('HX074-11C', true);
        BindSubscription(Partner);
        Runner.HX74SetCheckOut(ContractNo);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, StrSubstNo('A blocked vehicle an extension reports available can be checked out: %1', GetLastErrorText()));
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'The contract is checked out');
        Assert.AreEqual(1000, Contract."Start Km", 'Start km is the vehicle mileage');
        HX74AssertCheckedOut('HX074-11C', true);
    end;

    [Test]
    procedure CheckOutStatusBeforeAvailability()
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        Runner: Codeunit "HX074 Desk Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        HX74Prepare();
        HX74Vehicle('HX074-12C', 1000, false);
        ContractNo := HX74CheckedOutContract('HX074-12C');
        Vehicle.Get('HX074-12C');
        Vehicle.Blocked := true;
        Vehicle.Modify();
        Runner.HX74SetCheckOut(ContractNo);

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A contract that is not open cannot be checked out');
        Assert.AreEqual(StrSubstNo('Rental contract %1 must have status %2.', ContractNo, Contract.Status::Open), GetLastErrorText(), 'The status error comes before availability');
    end;

    local procedure HX74CheckedOutContract(VehicleNo: Code[20]) ContractNo: Code[20]
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX074 Customer', 20270301D, 20270303D);
        RentalMgt.CheckOut(ContractNo);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, StrSubstNo('Precondition: the contract on %1 is checked out', VehicleNo));
        HX74AssertCheckedOut(VehicleNo, true);
    end;

    local procedure HX74AssertContract(ContractNo: Code[20]; VehicleNo: Code[20]; StartKm: Integer)
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Get(ContractNo);
        Assert.AreEqual(VehicleNo, Contract."Vehicle No.", 'Contract vehicle');
        Assert.AreEqual(StartKm, Contract."Start Km", 'Contract start km');
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'Contract status');
    end;

    local procedure HX74AssertCheckedOut(VehicleNo: Code[20]; IsCheckedOut: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Assert.AreEqual(IsCheckedOut, Vehicle."Checked Out", StrSubstNo('Checked Out of %1', VehicleNo));
    end;

    local procedure HX74Prepare()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := 0;
        Setup."Km Allowance per Day" := 1000;
        Setup."Excess Km Rate" := 0;
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := 3;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure HX74Vehicle(VehicleNo: Code[20]; Mileage: Integer; IsBlocked: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        HX74RemoveVehicle(VehicleNo);
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := Mileage;
        Vehicle.Strategy := Vehicle.Strategy::Default;
        Vehicle.Insert();
        if IsBlocked then begin
            Vehicle.Blocked := true;
            Vehicle.Modify();
        end;
    end;

    local procedure HX74RemoveVehicle(VehicleNo: Code[20])
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
    end;
}
