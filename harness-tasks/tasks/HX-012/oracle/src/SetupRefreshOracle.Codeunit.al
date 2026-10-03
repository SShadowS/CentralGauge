codeunit 85700 "HX012 Setup Refresh Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure TriggeredPrecisionChangeReachesPreview()
    var
        Setup: Record "CGR Setup";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.01, '', 3);
        InitVehicle('HX012-A');
        ContractNo := ReturnedContract('HX012-A');
        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(135.63, Preview.TotalAmount(PreviewLine), 'Preview at the precision read first');

        Setup.Get();
        Setup."Amount Rounding Precision" := 1;
        Setup.Modify(true);

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(3, PreviewLine.Count(), 'Rental days, weekend surcharge and excess km');
        PreviewLine.FindSet();
        Assert.AreEqual(100.00, PreviewLine.Amount, 'Rental days line at the saved precision');
        PreviewLine.Next();
        Assert.AreEqual(33.00, PreviewLine.Amount, 'Weekend surcharge line at the saved precision');
        PreviewLine.Next();
        Assert.AreEqual(2.00, PreviewLine.Amount, 'Excess km line at the saved precision');
        Assert.AreEqual(135.00, Preview.TotalAmount(PreviewLine), 'Preview total at the saved precision');
    end;

    [Test]
    procedure TriggeredMaxAttemptsReachesDispatcher()
    var
        Setup: Record "CGR Setup";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
    begin
        WorkDate(20270301D);
        InitSetup(0.01, '', 3);
        Assert.AreEqual(3, Dispatcher.MaxAttempts(), 'Max attempts read first');

        Setup.Get();
        Setup."Outbox Max Attempts" := 5;
        Setup.Modify(true);

        Assert.AreEqual(5, Dispatcher.MaxAttempts(), 'Max attempts after a save with triggers');
    end;

    [Test]
    procedure TriggeredDefaultBranchReachesNewContract()
    var
        Setup: Record "CGR Setup";
        Contract: Record "CGR Rental Contract";
        SessionContext: Codeunit "CGR Session Context";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.01, 'HX12A', 3);
        InitVehicle('HX012-C');
        Assert.AreEqual('HX12A', SessionContext.CurrentBranch(), 'Default branch read first');

        Setup.Get();
        Setup."Default Branch Code" := 'HX12B';
        Setup.Modify(true);

        Assert.AreEqual('HX12B', SessionContext.CurrentBranch(), 'Default branch after a save with triggers');
        ContractNo := RentalMgt.CreateContract('HX012-C', 'HX012 Customer', 20270305D, 20270307D);
        Contract.Get(ContractNo);
        Assert.AreEqual('HX12B', Contract."Branch Code", 'A new contract takes the saved default branch');
    end;

    [Test]
    procedure ExplicitBranchSurvivesSetupSave()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
        AmountRounding: Codeunit "CGR Amount Rounding";
    begin
        WorkDate(20270301D);
        InitSetup(0.01, 'HX12A', 3);
        SessionContext.SetCurrentBranch('HX12X');
        Assert.AreEqual(0.01, AmountRounding.Precision(), 'Precision read first');

        Setup.Get();
        Setup."Amount Rounding Precision" := 1;
        Setup."Default Branch Code" := 'HX12B';
        Setup.Modify(true);

        Assert.AreEqual(1, AmountRounding.Precision(), 'Precision after a save with triggers');
        Assert.AreEqual('HX12X', SessionContext.CurrentBranch(), 'The explicitly chosen branch stays chosen');
    end;

    [Test]
    procedure UntriggeredSaveKeepsCache()
    var
        Setup: Record "CGR Setup";
        AmountRounding: Codeunit "CGR Amount Rounding";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        WorkDate(20270301D);
        InitSetup(0.01, '', 3);
        InitVehicle('HX012-E');
        Assert.AreEqual(0.01, AmountRounding.Precision(), 'Precision read first');

        Setup.Get();
        Setup."Amount Rounding Precision" := 0.05;
        Setup.Modify();
        Assert.AreEqual(0.01, AmountRounding.Precision(), 'A save without triggers keeps the values already read');

        RentalMgt.CreateContract('HX012-E', 'HX012 Customer', 20270305D, 20270307D);
        Assert.AreEqual(0.01, AmountRounding.Precision(), 'The contract number counter keeps the values already read');

        Setup.Get();
        Setup."Amount Rounding Precision" := 1;
        Setup.Modify(true);
        Assert.AreEqual(1, AmountRounding.Precision(), 'A later save with triggers is seen');
    end;

    // InsertedSetupIsRead and DeletedSetupIsDropped delete the Setup row, which resets
    // "Last Contract No."; a later row that creates contracts would reuse contract numbers.
    // Keep these two procedures last in the codeunit.
    [Test]
    procedure InsertedSetupIsRead()
    var
        Setup: Record "CGR Setup";
        AmountRounding: Codeunit "CGR Amount Rounding";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
    begin
        WorkDate(20270301D);
        InitSetup(0.05, '', 5);
        Assert.AreEqual(0.05, AmountRounding.Precision(), 'Precision read first');

        Setup.Get();
        Setup.Delete();
        Assert.AreEqual(0.05, AmountRounding.Precision(), 'A delete without triggers keeps the values already read');

        Setup.Init();
        Setup."Amount Rounding Precision" := 0.5;
        Setup."Outbox Max Attempts" := 6;
        Setup.Insert();
        Assert.AreEqual(0.05, AmountRounding.Precision(), 'An insert without triggers keeps the values already read');

        Setup.Get();
        Setup.Delete();
        Setup.Init();
        Setup."Amount Rounding Precision" := 1;
        Setup."Outbox Max Attempts" := 7;
        Setup.Insert(true);

        Assert.AreEqual(1, AmountRounding.Precision(), 'Precision of the Setup inserted with triggers');
        Assert.AreEqual(7, Dispatcher.MaxAttempts(), 'Max attempts of the Setup inserted with triggers');
    end;

    [Test]
    procedure DeletedSetupIsDropped()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
        AmountRounding: Codeunit "CGR Amount Rounding";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
    begin
        WorkDate(20270301D);
        InitSetup(0.05, 'HX12D', 5);
        Assert.AreEqual(0.05, AmountRounding.Precision(), 'Precision read first');
        Assert.AreEqual('HX12D', SessionContext.CurrentBranch(), 'Default branch read first');

        Setup.Get();
        Setup.Delete(true);

        Assert.AreEqual(0.01, AmountRounding.Precision(), 'Without a Setup record the precision is 0.01');
        Assert.AreEqual(3, Dispatcher.MaxAttempts(), 'Without a Setup record max attempts is 3');
        Assert.AreEqual('', SessionContext.CurrentBranch(), 'Without a Setup record there is no default branch');
    end;

    local procedure InitSetup(RoundingPrecision: Decimal; DefaultBranchCode: Code[10]; OutboxMaxAttempts: Integer)
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := 50;
        Setup."Km Allowance per Day" := 100;
        Setup."Excess Km Rate" := 0.33;
        Setup."Suspend Rentals" := false;
        Setup."Amount Rounding Precision" := RoundingPrecision;
        Setup."Default Branch Code" := DefaultBranchCode;
        Setup."Outbox Max Attempts" := OutboxMaxAttempts;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure InitVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.SetRange("Vehicle No.", VehicleNo);
        LedgerEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle."Daily Rate" := 33.33;
        Vehicle.Insert();
    end;

    local procedure ReturnedContract(VehicleNo: Code[20]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX012 Customer', 20270305D, 20270307D);
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1307, '');
        exit(ContractNo);
    end;
}
