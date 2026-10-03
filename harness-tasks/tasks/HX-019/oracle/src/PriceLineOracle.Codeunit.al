codeunit 85840 "HX019 Price Line Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure ExtensionLineInPreview()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        PriceExtension: Codeunit "HX019 Price Extension";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0, 1000, 0);
        InitVehicle('HX019-1A');
        ContractNo := ReturnedContract('HX019-1A', 20270301D, 20270303D, 1100);
        PriceExtension.AddInsuranceTo(ContractNo);
        BindSubscription(PriceExtension);

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(2, PreviewLine.Count(), 'The contract''s own line plus the extension''s line');
        PreviewLine.FindFirst();
        Assert.AreEqual('Rental days', PreviewLine.Description, 'The contract''s own line comes first');
        Assert.AreEqual(150.00, PreviewLine.Amount, 'Own line amount 3 x 50');
        PreviewLine.FindLast();
        Assert.AreEqual('Insurance', PreviewLine.Description, 'The extension''s line comes last');
        Assert.AreEqual(10.00, PreviewLine.Amount, 'Extension line amount');
        Assert.AreEqual(160.00, Preview.TotalAmount(PreviewLine), 'Preview total includes the extension''s line');
    end;

    [Test]
    procedure ExtensionLineFollowsOwnLines()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        PriceExtension: Codeunit "HX019 Price Extension";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(50, 100, 0.5);
        InitVehicle('HX019-2A');
        ContractNo := ReturnedContract('HX019-2A', 20270305D, 20270307D, 1400);
        PriceExtension.AddInsuranceTo(ContractNo);
        BindSubscription(PriceExtension);

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(3, PriceExtension.LinesSeenOnEntry(), 'The event is raised once all three own lines are there');
        Assert.AreEqual(4, PreviewLine.Count(), 'Three own lines plus the extension''s line');
        PreviewLine.FindLast();
        Assert.AreEqual('Insurance', PreviewLine.Description, 'The extension''s line comes after the own lines');
        Assert.AreEqual(260.00, Preview.TotalAmount(PreviewLine), '150 days + 50 weekend + 50 excess km + 10 insurance');
    end;

    [Test]
    procedure ExtensionLineSinglePosted()
    var
        PriceExtension: Codeunit "HX019 Price Extension";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0, 1000, 0);
        InitVehicle('HX019-3A');
        ContractNo := ReturnedContract('HX019-3A', 20270301D, 20270303D, 1100);
        PriceExtension.AddInsuranceTo(ContractNo);
        BindSubscription(PriceExtension);

        RentalMgt.Post(ContractNo);
        AssertPostedAmount(ContractNo, 160.00);
    end;

    [Test]
    procedure ExtensionLineBatchPosted()
    var
        Contract: Record "CGR Rental Contract";
        PriceExtension: Codeunit "HX019 Price Extension";
        BatchPost: Codeunit "CGR Rental Batch Post";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0, 1000, 0);
        InitVehicle('HX019-4A');
        ContractNo := ReturnedContract('HX019-4A', 20270301D, 20270303D, 1100);
        PriceExtension.AddInsuranceTo(ContractNo);
        BindSubscription(PriceExtension);

        Contract.SetRange("Vehicle No.", 'HX019-4A');
        Assert.AreEqual(1, BatchPost.PostBatch(Contract), 'The contract is posted in the batch');
        AssertPostedAmount(ContractNo, 160.00);
    end;

    [Test]
    procedure CommittingExtensionFailsPreview()
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        PriceExtension: Codeunit "HX019 Price Extension";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        WorkDate(20270301D);
        InitSetup(0, 1000, 0);
        InitVehicle('HX019-5A');
        RemoveMarker('HX019-M5');
        ContractNo := ReturnedContract('HX019-5A', 20270301D, 20270303D, 1100);
        PriceExtension.AddInsuranceTo(ContractNo);
        PriceExtension.CommitWithMarker('HX019-M5');
        BindSubscription(PriceExtension);
        Contract.Get(ContractNo);
        Commit();

        Ok := Codeunit.Run(Codeunit::"HX019 Preview Runner", Contract);
        Assert.IsFalse(Ok, 'A preview fails when a commit is attempted while it is built');
        Assert.IsFalse(Vehicle.Get('HX019-M5'), 'Nothing written while the preview was built is kept');
    end;

    [Test]
    procedure CommittingExtensionSinglePostPosts()
    var
        Contract: Record "CGR Rental Contract";
        PriceExtension: Codeunit "HX019 Price Extension";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        WorkDate(20270301D);
        InitSetup(0, 1000, 0);
        InitVehicle('HX019-6A');
        RemoveMarker('HX019-M6');
        ContractNo := ReturnedContract('HX019-6A', 20270301D, 20270303D, 1100);
        PriceExtension.AddInsuranceTo(ContractNo);
        PriceExtension.CommitWithMarker('HX019-M6');
        BindSubscription(PriceExtension);
        Contract.Get(ContractNo);
        Commit();

        Ok := Codeunit.Run(Codeunit::"HX019 Post Runner", Contract);
        Assert.IsTrue(Ok, 'Posting a contract on its own still completes when an extension commits');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'The contract is posted');
        AssertPostedAmount(ContractNo, 160.00);
    end;

    [Test]
    procedure CommittingExtensionBatchPosts()
    var
        Contract: Record "CGR Rental Contract";
        PostError: Record "CGR Batch Post Error";
        PriceExtension: Codeunit "HX019 Price Extension";
        BatchPost: Codeunit "CGR Rental Batch Post";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0, 1000, 0);
        InitVehicle('HX019-7A');
        RemoveMarker('HX019-M7');
        ContractNo := ReturnedContract('HX019-7A', 20270301D, 20270303D, 1100);
        PriceExtension.AddInsuranceTo(ContractNo);
        PriceExtension.CommitWithMarker('HX019-M7');
        BindSubscription(PriceExtension);

        Contract.SetRange("Vehicle No.", 'HX019-7A');
        Assert.AreEqual(1, BatchPost.PostBatch(Contract), 'Batch posting still posts the contract when an extension commits');
        PostError.SetRange("Batch Id", BatchPost.LastBatchId());
        Assert.AreEqual(0, PostError.Count(), 'No batch posting error is logged');
        AssertPostedAmount(ContractNo, 160.00);
    end;

    [Test]
    procedure PreviewWithoutExtensionUnchanged()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0, 1000, 0);
        InitVehicle('HX019-8A');
        ContractNo := ReturnedContract('HX019-8A', 20270301D, 20270303D, 1100);

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(1, PreviewLine.Count(), 'Only the contract''s own line');
        PreviewLine.FindFirst();
        Assert.AreEqual('Rental days', PreviewLine.Description, 'The contract''s own line');
        Assert.AreEqual(150.00, Preview.TotalAmount(PreviewLine), 'Preview total 3 x 50');
    end;

    local procedure InitSetup(WeekendSurchargePct: Decimal; KmAllowancePerDay: Integer; ExcessKmRate: Decimal)
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := WeekendSurchargePct;
        Setup."Km Allowance per Day" := KmAllowancePerDay;
        Setup."Excess Km Rate" := ExcessKmRate;
        Setup."Suspend Rentals" := false;
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
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
        Vehicle."Daily Rate" := 50;
        Vehicle.Insert();
    end;

    local procedure RemoveMarker(MarkerVehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if Vehicle.Get(MarkerVehicleNo) then
            Vehicle.Delete();
    end;

    local procedure ReturnedContract(VehicleNo: Code[20]; StartDate: Date; EndDate: Date; ReturnKm: Integer): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX019 Customer', StartDate, EndDate);
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, ReturnKm, '');
        exit(ContractNo);
    end;

    local procedure AssertPostedAmount(ContractNo: Code[20]; ExpectedAmount: Decimal)
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, LedgerEntry.Count(), 'One rental ledger entry for the contract');
        LedgerEntry.FindFirst();
        Assert.AreEqual(ExpectedAmount, LedgerEntry.Amount, 'Posted amount includes the extension''s line');
    end;
}
