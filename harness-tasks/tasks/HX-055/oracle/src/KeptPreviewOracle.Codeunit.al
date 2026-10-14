codeunit 86560 "HX055 Kept Preview Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure KeptPreviewReturned()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractA: Code[20];
    begin
        InitHX55();
        ContractA := NewHX55Contract('HX055-R1A', 50);

        Preview.KeepPreview(ContractA);
        Assert.IsTrue(Preview.GetKeptPreview(ContractA, PreviewLine), 'A kept preview is found');
        AssertHX55Lines(PreviewLine, 50, 'Kept preview of A');
        EndHX55();
    end;

    [Test]
    procedure TwoContractsKept()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        Runner: Codeunit "HX055 Keep Runner";
        ContractA: Code[20];
        ContractB: Code[20];
        Ok: Boolean;
    begin
        InitHX55();
        ContractA := NewHX55Contract('HX055-R2A', 50);
        ContractB := NewHX55Contract('HX055-R2B', 60);

        Preview.KeepPreview(ContractA);
        Runner.SetContract(ContractB);
        Commit();
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'Keeping a second contract''s preview succeeds: ' + GetLastErrorText());

        Assert.IsTrue(Preview.GetKeptPreview(ContractA, PreviewLine), 'A is still kept');
        AssertHX55Lines(PreviewLine, 50, 'Kept preview of A after B was kept');
        Assert.IsTrue(Preview.GetKeptPreview(ContractB, PreviewLine), 'B is kept');
        AssertHX55Lines(PreviewLine, 60, 'Kept preview of B');
        EndHX55();
    end;

    [Test]
    procedure KeptAcrossInstances()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview1: Codeunit "CGR Rental Invoice Preview";
        Preview2: Codeunit "CGR Rental Invoice Preview";
        ContractA: Code[20];
    begin
        InitHX55();
        ContractA := NewHX55Contract('HX055-R3A', 50);

        Preview1.KeepPreview(ContractA);
        Assert.IsTrue(Preview2.GetKeptPreview(ContractA, PreviewLine), 'Another variable sees the kept preview');
        AssertHX55Lines(PreviewLine, 50, 'Kept preview through another variable');
        EndHX55();
    end;

    [Test]
    procedure KeptPreviewIgnoresLaterPrices()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        BuiltLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractA: Code[20];
    begin
        InitHX55();
        ContractA := NewHX55Contract('HX055-R4A', 50);

        Preview.KeepPreview(ContractA);
        SetHX55Rate('HX055-R4A', 80);
        SetHX55Surcharge(0);

        Preview.BuildPreview(ContractA, BuiltLine);
        Assert.AreEqual(1, BuiltLine.Count(), 'Precondition: today''s preview has only the rental days line');
        BuiltLine.FindFirst();
        Assert.AreEqual(240.00, BuiltLine.Amount, 'Precondition: today''s preview prices 3 x 80');

        Assert.IsTrue(Preview.GetKeptPreview(ContractA, PreviewLine), 'A is kept');
        AssertHX55Lines(PreviewLine, 50, 'The kept preview shows the prices at keep time');
        EndHX55();
    end;

    [Test]
    procedure KeepAgainReplaces()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractA: Code[20];
    begin
        InitHX55();
        ContractA := NewHX55Contract('HX055-R5A', 50);

        Preview.KeepPreview(ContractA);
        SetHX55Rate('HX055-R5A', 80);
        Preview.KeepPreview(ContractA);

        Assert.IsTrue(Preview.GetKeptPreview(ContractA, PreviewLine), 'A is kept');
        AssertHX55Lines(PreviewLine, 80, 'Keeping again replaces the earlier preview');
        EndHX55();
    end;

    [Test]
    procedure HandedOutLinesAreCopies()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        SecondLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractA: Code[20];
    begin
        InitHX55();
        ContractA := NewHX55Contract('HX055-R6A', 50);

        Preview.KeepPreview(ContractA);
        Assert.IsTrue(Preview.GetKeptPreview(ContractA, PreviewLine), 'A is kept');
        PreviewLine.DeleteAll();

        Assert.IsTrue(Preview.GetKeptPreview(ContractA, SecondLine), 'A is still kept after the caller deleted its lines');
        AssertHX55Lines(SecondLine, 50, 'Deleting the handed-out lines does not change the kept preview');
        EndHX55();
    end;

    [Test]
    procedure CallerBufferReplaced()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractA: Code[20];
    begin
        InitHX55();
        ContractA := NewHX55Contract('HX055-R7A', 50);
        InsertHX55Foreign(PreviewLine, 50000);
        InsertHX55Foreign(PreviewLine, 60000);
        PreviewLine.SetRange("Line No.", 60000);

        Preview.KeepPreview(ContractA);
        Assert.IsTrue(Preview.GetKeptPreview(ContractA, PreviewLine), 'A is kept');
        PreviewLine.Reset();
        Assert.AreEqual(2, PreviewLine.Count(), 'Only the kept lines are handed out');
        PreviewLine.SetFilter("Line No.", '<>%1&<>%2', 10000, 20000);
        Assert.IsTrue(PreviewLine.IsEmpty(), 'The caller''s earlier lines are gone');
        PreviewLine.Reset();
        AssertHX55Lines(PreviewLine, 50, 'The handed-out lines are the kept ones');
        EndHX55();
    end;

    [Test]
    procedure NothingKeptReturnsFalse()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractA: Code[20];
        ContractC: Code[20];
    begin
        InitHX55();
        ContractA := NewHX55Contract('HX055-R8A', 50);
        ContractC := NewHX55Contract('HX055-R8C', 50);
        InsertHX55Foreign(PreviewLine, 50000);

        Preview.KeepPreview(ContractA);

        Assert.IsFalse(Preview.GetKeptPreview(ContractC, PreviewLine), 'Nothing is kept for C');
        PreviewLine.Reset();
        Assert.IsTrue(PreviewLine.IsEmpty(), 'PreviewLine is empty when nothing is kept');
        EndHX55();
    end;

    [Test]
    procedure FailedKeepLeavesEarlierPreview()
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        Runner: Codeunit "HX055 Keep Runner";
        ContractA: Code[20];
        Ok: Boolean;
    begin
        InitHX55();
        Contract.SetRange("Vehicle No.", 'HX055-NONE');
        Contract.DeleteAll();
        if Vehicle.Get('HX055-NONE') then
            Vehicle.Delete();
        ContractA := NewHX55Contract('HX055-R9A', 50);

        Preview.KeepPreview(ContractA);
        Contract.Get(ContractA);
        Contract."Vehicle No." := 'HX055-NONE';
        Contract.Modify();
        Runner.SetContract(ContractA);
        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'Keeping a preview that cannot be built fails');
        Assert.AreEqual('The CGR Vehicle does not exist. Identification fields and values: No.=''HX055-NONE''', GetLastErrorText(), 'The pricing error reaches the caller');
        Assert.IsTrue(Preview.GetKeptPreview(ContractA, PreviewLine), 'The earlier preview of A is still kept');
        AssertHX55Lines(PreviewLine, 50, 'The earlier preview of A is unchanged');
        EndHX55();
    end;

    [Test]
    procedure MissingContractFails()
    var
        Contract: Record "CGR Rental Contract";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        Runner: Codeunit "HX055 Keep Runner";
        ContractB: Code[20];
        Ok: Boolean;
    begin
        InitHX55();
        if Contract.Get('HX055-NONE') then
            Contract.Delete();
        ContractB := NewHX55Contract('HX055-R10B', 50);

        Preview.KeepPreview(ContractB);
        Runner.SetContract('HX055-NONE');
        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'Keeping the preview of an unknown contract fails');
        Assert.AreEqual('The CGR Rental Contract does not exist. Identification fields and values: No.=''HX055-NONE''', GetLastErrorText(), 'The not-found error reaches the caller');
        Assert.IsTrue(Preview.GetKeptPreview(ContractB, PreviewLine), 'B is still kept');
        AssertHX55Lines(PreviewLine, 50, 'B is unchanged');
        EndHX55();
    end;

    [Test]
    procedure ForgetDropsAll()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractA: Code[20];
        ContractB: Code[20];
    begin
        InitHX55();
        ContractA := NewHX55Contract('HX055-R11A', 50);
        ContractB := NewHX55Contract('HX055-R11B', 60);

        Preview.KeepPreview(ContractA);
        Preview.KeepPreview(ContractB);
        Assert.IsTrue(Preview.GetKeptPreview(ContractA, PreviewLine), 'Precondition: A is kept');
        Assert.IsTrue(Preview.GetKeptPreview(ContractB, PreviewLine), 'Precondition: B is kept');

        Preview.ForgetKeptPreviews();
        Assert.IsFalse(Preview.GetKeptPreview(ContractA, PreviewLine), 'A is forgotten');
        Assert.IsFalse(Preview.GetKeptPreview(ContractB, PreviewLine), 'B is forgotten');
        EndHX55();
    end;

    [Test]
    procedure BuildPreviewKeepsNothing()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        KeptLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractA: Code[20];
    begin
        InitHX55();
        ContractA := NewHX55Contract('HX055-R12A', 50);

        Preview.BuildPreview(ContractA, PreviewLine);
        AssertHX55Lines(PreviewLine, 50, 'BuildPreview builds as today');
        Assert.AreEqual(200.00, Preview.TotalAmount(PreviewLine), 'TotalAmount sums as today');
        Assert.IsFalse(Preview.GetKeptPreview(ContractA, KeptLine), 'BuildPreview keeps nothing');
        EndHX55();
    end;

    [Test]
    procedure KeptPreviewIgnoresLaterPrecision()
    var
        Setup: Record "CGR Setup";
        PreviewLine: Record "CGR Invoice Preview Line";
        BuiltLine: Record "CGR Invoice Preview Line";
        SessionContext: Codeunit "CGR Session Context";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractA: Code[20];
    begin
        InitHX55();
        ContractA := NewHX55Contract('HX055-R13A', 33.33);

        Preview.KeepPreview(ContractA);
        Setup.Get();
        Setup."Amount Rounding Precision" := 1;
        Setup.Modify();
        SessionContext.Reset();

        Preview.BuildPreview(ContractA, BuiltLine);
        BuiltLine.Get(10000);
        Assert.AreEqual(100.00, BuiltLine.Amount, 'Precondition: today''s preview rounds 3 x 33.33 to whole units');

        Assert.IsTrue(Preview.GetKeptPreview(ContractA, PreviewLine), 'A is kept');
        Assert.AreEqual(2, PreviewLine.Count(), 'Rental days and weekend surcharge');
        PreviewLine.Get(10000);
        Assert.AreEqual(99.99, PreviewLine.Amount, 'The kept rental days amount keeps the precision at keep time');
        PreviewLine.Get(20000);
        Assert.AreEqual(33.33, PreviewLine.Amount, 'The kept weekend surcharge amount keeps the precision at keep time');
        EndHX55();
    end;

    [Test]
    procedure OtherContractSurvivesReplace()
    var
        LineA: Record "CGR Invoice Preview Line";
        LineB: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractA: Code[20];
        ContractB: Code[20];
    begin
        InitHX55();
        ContractA := NewHX55Contract('HX055-R14A', 50);
        ContractB := NewHX55Contract('HX055-R14B', 60);

        Preview.KeepPreview(ContractA);
        Preview.KeepPreview(ContractB);
        SetHX55Rate('HX055-R14A', 80);
        Preview.KeepPreview(ContractA);

        Assert.IsTrue(Preview.GetKeptPreview(ContractB, LineB), 'B is still kept after A was kept again');
        AssertHX55Lines(LineB, 60, 'Replacing A leaves B as first kept');
        Assert.IsTrue(Preview.GetKeptPreview(ContractA, LineA), 'A is kept');
        AssertHX55Lines(LineA, 80, 'A is replaced');
        EndHX55();
    end;

    local procedure InitHX55()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
        Preview: Codeunit "CGR Rental Invoice Preview";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := 3;
        Setup."Weekend Surcharge %" := 50;
        Setup."Km Allowance per Day" := 1000;
        Setup."Excess Km Rate" := 0;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
        Preview.ForgetKeptPreviews();
    end;

    local procedure EndHX55()
    var
        Preview: Codeunit "CGR Rental Invoice Preview";
    begin
        Preview.ForgetKeptPreviews();
    end;

    local procedure NewHX55Contract(VehicleNo: Code[20]; DailyRate: Decimal): Code[20]
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle.Strategy := Vehicle.Strategy::Default;
        Vehicle."Daily Rate" := DailyRate;
        Vehicle.Insert();
        exit(RentalMgt.CreateContract(VehicleNo, 'HX055', 20270305D, 20270307D));
    end;

    local procedure SetHX55Rate(VehicleNo: Code[20]; DailyRate: Decimal)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Vehicle."Daily Rate" := DailyRate;
        Vehicle.Modify();
    end;

    local procedure SetHX55Surcharge(WeekendSurchargePct: Decimal)
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.Get();
        Setup."Weekend Surcharge %" := WeekendSurchargePct;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure InsertHX55Foreign(var PreviewLine: Record "CGR Invoice Preview Line"; LineNo: Integer)
    begin
        PreviewLine.Init();
        PreviewLine."Line No." := LineNo;
        PreviewLine."Contract No." := 'HX055-FOREIGN';
        PreviewLine.Description := 'Foreign line';
        PreviewLine.Quantity := 1;
        PreviewLine."Unit Price" := 7;
        PreviewLine.Amount := 7;
        PreviewLine.Insert(false);
    end;

    local procedure AssertHX55Lines(var PreviewLine: Record "CGR Invoice Preview Line"; DailyRate: Decimal; Context: Text)
    begin
        PreviewLine.Reset();
        Assert.AreEqual(2, PreviewLine.Count(), Context + ': rental days and weekend surcharge');
        PreviewLine.FindSet();
        Assert.AreEqual(10000, PreviewLine."Line No.", Context + ': first line number');
        Assert.AreEqual('Rental days', PreviewLine.Description, Context + ': first line');
        Assert.AreEqual(3.0, PreviewLine.Quantity, Context + ': three rental days');
        Assert.AreEqual(DailyRate, PreviewLine."Unit Price", Context + ': daily rate');
        Assert.AreEqual(3 * DailyRate, PreviewLine.Amount, Context + ': rental days amount');
        PreviewLine.Next();
        Assert.AreEqual(20000, PreviewLine."Line No.", Context + ': second line number');
        Assert.AreEqual('Weekend surcharge', PreviewLine.Description, Context + ': second line');
        Assert.AreEqual(2.0, PreviewLine.Quantity, Context + ': Saturday and Sunday');
        Assert.AreEqual(DailyRate / 2, PreviewLine."Unit Price", Context + ': half the daily rate');
        Assert.AreEqual(DailyRate, PreviewLine.Amount, Context + ': weekend surcharge amount');
    end;
}
