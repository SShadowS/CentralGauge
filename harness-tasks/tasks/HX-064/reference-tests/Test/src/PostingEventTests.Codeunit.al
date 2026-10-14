codeunit 80113 "CGR Posting Event Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure ExtensionDayIsCharged()
    var
        Contract: Record "CGR Rental Contract";
        Entry: Record "CGR Rental Ledger Entry";
        Spy: Codeunit "CGR Posting Event Spy";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := CreateReturnedContract('HX064-V01');
        Contract.Get(ContractNo);
        Assert.AreEqual(20270303D, Contract."End Date", 'The contract ends on 3 March before posting');
        Spy.ExtendContract(ContractNo, 1);
        BindSubscription(Spy);

        RentalMgt.Post(ContractNo);
        UnbindSubscription(Spy);

        Contract.Get(ContractNo);
        Assert.AreEqual(20270304D, Contract."End Date", 'The extended end date is stored');
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'The contract is posted');
        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Entry.Count(), 'Posting creates one ledger entry');
        Entry.FindFirst();
        Assert.AreEqual('HX064-V01', Entry."Vehicle No.", 'Ledger entry vehicle');
        Assert.AreEqual(20270304D, Entry."Posting Date", 'The entry is posted on the extended end date');
        Assert.AreEqual(200.00, Entry.Amount, 'The extended contract is charged: 4 days x 50');
        Assert.AreEqual(200, Entry."Km Driven", 'Km driven is return km minus start km');
        Assert.AreEqual(1, Spy.BeforeCount(), 'OnBeforePostRentalContract is raised once');
        Assert.AreEqual(1, Spy.AfterCount(), 'OnAfterPostRentalContract is raised once');
        Assert.AreEqual(200.00, Spy.AfterAmount(), 'OnAfterPostRentalContract carries the posted amount');
    end;

    [Test]
    procedure AfterEventSeesPostedContractAndEntry()
    var
        Spy: Codeunit "CGR Posting Event Spy";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := CreateReturnedContract('HX064-V02');
        BindSubscription(Spy);

        RentalMgt.Post(ContractNo);
        UnbindSubscription(Spy);

        Assert.AreEqual(1, Spy.AfterCount(), 'OnAfterPostRentalContract is raised once');
        Assert.AreEqual(150.00, Spy.AfterAmount(), 'OnAfterPostRentalContract carries the posted amount: 3 days x 50');
        Assert.AreEqual(Enum::"CGR Rental Status"::Posted, Spy.AfterRecStatus(), 'The subscriber gets the contract as Posted');
        Assert.AreEqual(Enum::"CGR Rental Status"::Posted, Spy.AfterStoredStatus(), 'The contract is stored as Posted when OnAfter is raised');
        Assert.IsTrue(Spy.AfterLedgerEntryExisted(), 'The ledger entry exists when OnAfter is raised');
    end;

    [Test]
    procedure KmDrivenIsFromTheContract()
    var
        Vehicle: Record "CGR Vehicle";
        Entry: Record "CGR Rental Ledger Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := CreateReturnedContract('HX064-V03');
        Vehicle.Get('HX064-V03');
        Vehicle.Mileage := 5000;
        Vehicle.Modify();
        Vehicle.Get('HX064-V03');
        Assert.AreEqual(5000, Vehicle.Mileage, 'The vehicle mileage changed after the return');

        RentalMgt.Post(ContractNo);

        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Entry.Count(), 'Posting creates one ledger entry');
        Entry.FindFirst();
        Assert.AreEqual(200, Entry."Km Driven", 'Km driven is the contract''s return km minus its start km');
        Assert.AreEqual(150.00, Entry.Amount, '3 days x 50');
    end;

    [Test]
    procedure RefusedPostingRaisesNoEvent()
    var
        Spy: Codeunit "CGR Posting Event Spy";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Initialize('HX064-V04');
        ContractNo := Lib.CreateContract('HX064-V04');
        BindSubscription(Spy);

        asserterror RentalMgt.Post(ContractNo);
        UnbindSubscription(Spy);

        Assert.ExpectedError(StrSubstNo('Rental contract %1 must be returned before it is posted.', ContractNo));
        Assert.AreEqual(0, Spy.BeforeCount(), 'A refused posting raises no OnBeforePostRentalContract');
        Assert.AreEqual(0, Spy.AfterCount(), 'A refused posting raises no OnAfterPostRentalContract');
    end;

    [Test]
    procedure CheckedOutPostingIsRefused()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Posting Event Spy";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Initialize('HX064-V05');
        ContractNo := Lib.CreateContract('HX064-V05');
        RentalMgt.CheckOut(ContractNo);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'The contract is checked out before posting');
        BindSubscription(Spy);

        asserterror RentalMgt.Post(ContractNo);
        UnbindSubscription(Spy);

        Assert.ExpectedError(StrSubstNo('Rental contract %1 must be returned before it is posted.', ContractNo));
        Assert.AreEqual(0, Spy.BeforeCount(), 'A refused posting raises no OnBeforePostRentalContract');
        Assert.AreEqual(0, Spy.AfterCount(), 'A refused posting raises no OnAfterPostRentalContract');
    end;

    [Test]
    procedure PostedContractIsNotPostedAgain()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Posting Event Spy";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := CreateReturnedContract('HX064-V06');
        RentalMgt.Post(ContractNo);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'The contract is posted before the second posting');
        BindSubscription(Spy);

        asserterror RentalMgt.Post(ContractNo);
        UnbindSubscription(Spy);

        Assert.ExpectedError(StrSubstNo('Rental contract %1 must be returned before it is posted.', ContractNo));
        Assert.AreEqual(0, Spy.BeforeCount(), 'A refused posting raises no OnBeforePostRentalContract');
        Assert.AreEqual(0, Spy.AfterCount(), 'A refused posting raises no OnAfterPostRentalContract');
    end;

    local procedure Initialize(VehicleNo: Code[20])
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.SetPricing(0, 1000, 0);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, 50);
        Lib.ClearLedgerEntries(VehicleNo);
    end;

    local procedure CreateReturnedContract(VehicleNo: Code[20]): Code[20]
    begin
        Initialize(VehicleNo);
        exit(Lib.CreateReturnedContract(VehicleNo, 20270301D, 20270303D, 1200));
    end;
}
