codeunit 86820 "HX068 Day Close Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        PreparationFailedTxt: Label 'HX068 preparation failed.', Locked = true;
        ExportFailedTxt: Label 'HX068 export failed.', Locked = true;
        SimulatedFailureTxt: Label 'Simulated failure after commit for %1.', Comment = '%1 = contract number', Locked = true;

    [Test]
    procedure ReturnedContractsPosted()
    var
        Contract: Record "CGR Rental Contract";
        Partner: Codeunit "HX068 Close Partner";
        Runner: Codeunit "HX068 Close Runner";
        ContractA: Code[20];
        ContractB: Code[20];
        Ok: Boolean;
    begin
        Assert.AreEqual(70231, Codeunit::"CGR Desk Day Close", 'CGR Desk Day Close is codeunit 70231');
        HX068Init();
        HX068Vehicle('HX068-1A');
        HX068Vehicle('HX068-1B');
        ContractA := HX068Returned('HX068-1A');
        ContractB := HX068Returned('HX068-1B');
        Partner.HX068Watch(ContractA);
        Partner.HX068Watch(ContractB);
        BindSubscription(Partner);
        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX068-1A', 'HX068-1B');
        Runner.HX068SetFilter(Contract);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The day close completes: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.HX068LastPosted(), 'Two contracts are posted');
        HX068AssertPosted(ContractA, 'Contract A');
        HX068AssertPosted(ContractB, 'Contract B');
        Assert.AreEqual(0, HX068ErrorRows(ContractA), 'No error is logged for contract A');
        Assert.AreEqual(0, HX068ErrorRows(ContractB), 'No error is logged for contract B');
        Assert.AreEqual(1, Partner.HX068PrepareCalls(), 'The day close is prepared once');
        Assert.AreEqual(2, Partner.HX068ReturnedAtPrepare(), 'Both contracts are still returned while the day close is prepared');
        Assert.AreEqual(1, Partner.HX068ExportCalls(), 'The day is exported once');
        Assert.AreEqual(2, Partner.HX068ExportedCount(), 'The export gets the number posted');
        Assert.AreEqual(2, Partner.HX068PostedAtExport(), 'Both contracts are posted when the day is exported');
        Assert.AreEqual(2, Partner.HX068LedgerAtExport(), 'Both ledger entries exist when the day is exported');
    end;

    [Test]
    procedure ExportFailureKeepsPostings()
    var
        Contract: Record "CGR Rental Contract";
        Partner: Codeunit "HX068 Close Partner";
        Runner: Codeunit "HX068 Close Runner";
        ContractA: Code[20];
        ContractB: Code[20];
        Ok: Boolean;
    begin
        HX068Init();
        HX068Vehicle('HX068-2A');
        HX068Vehicle('HX068-2B');
        ContractA := HX068Returned('HX068-2A');
        ContractB := HX068Returned('HX068-2B');
        Partner.HX068FailExport();
        BindSubscription(Partner);
        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX068-2A', 'HX068-2B');
        Runner.HX068SetFilter(Contract);

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A failing export fails the day close');
        Assert.AreEqual(ExportFailedTxt, GetLastErrorText(), 'The day close fails with the export''s error');
        Assert.AreEqual(1, Partner.HX068ExportCalls(), 'The day is exported once');
        HX068AssertPosted(ContractA, 'Contract A stays posted after the failed export:');
        HX068AssertPosted(ContractB, 'Contract B stays posted after the failed export:');
    end;

    [Test]
    procedure ExportFailureKeepsErrorLog()
    var
        Contract: Record "CGR Rental Contract";
        PostError: Record "CGR Batch Post Error";
        Partner: Codeunit "HX068 Close Partner";
        Runner: Codeunit "HX068 Close Runner";
        ContractA: Code[20];
        ContractF: Code[20];
        Ok: Boolean;
    begin
        HX068Init();
        HX068Vehicle('HX068-3A');
        HX068Vehicle('HX068-3F');
        ContractA := HX068Returned('HX068-3A');
        ContractF := HX068Returned('HX068-3F');
        Partner.HX068FailPostingFor(ContractF);
        Partner.HX068FailExport();
        BindSubscription(Partner);
        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX068-3A', 'HX068-3F');
        Runner.HX068SetFilter(Contract);

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A failing export fails the day close');
        Assert.AreEqual(ExportFailedTxt, GetLastErrorText(), 'The day close fails with the export''s error');
        HX068AssertPosted(ContractA, 'Contract A stays posted after the failed export:');
        HX068AssertReturned(ContractF, 'The failing contract');
        Assert.AreEqual(1, HX068ErrorRows(ContractF), 'The failing contract''s error stays logged after the failed export');
        PostError.SetRange("Contract No.", ContractF);
        PostError.FindFirst();
        Assert.AreEqual(StrSubstNo(SimulatedFailureTxt, ContractF), PostError."Error Message", 'The logged error text');
    end;

    [Test]
    procedure CommittingPreparationThenErrorKeepsNothing()
    var
        Contract: Record "CGR Rental Contract";
        Partner: Codeunit "HX068 Close Partner";
        Runner: Codeunit "HX068 Close Runner";
        ContractA: Code[20];
        ContractB: Code[20];
        Ok: Boolean;
    begin
        HX068Init();
        HX068ClearMarker('HX068-M4');
        HX068Vehicle('HX068-4A');
        HX068Vehicle('HX068-4B');
        ContractA := HX068Returned('HX068-4A');
        ContractB := HX068Returned('HX068-4B');
        Partner.HX068SetPreparation('HX068-M4', true, true);
        BindSubscription(Partner);
        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX068-4A', 'HX068-4B');
        Runner.HX068SetFilter(Contract);

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A failing preparation fails the day close');
        Assert.AreEqual(PreparationFailedTxt, GetLastErrorText(), 'The day close fails with the preparation''s error');
        Assert.AreEqual(0, HX068MarkerCount('HX068-M4'), 'What the preparation wrote before its commit is not kept');
        HX068AssertReturned(ContractA, 'Contract A');
        HX068AssertReturned(ContractB, 'Contract B');
        Assert.AreEqual(0, Partner.HX068ExportCalls(), 'The day is not exported');
    end;

    [Test]
    procedure CommittingPreparationDoesNotFail()
    var
        Contract: Record "CGR Rental Contract";
        Partner: Codeunit "HX068 Close Partner";
        Runner: Codeunit "HX068 Close Runner";
        ContractA: Code[20];
        ContractB: Code[20];
        Ok: Boolean;
    begin
        HX068Init();
        HX068ClearMarker('HX068-M5');
        HX068Vehicle('HX068-5A');
        HX068Vehicle('HX068-5B');
        ContractA := HX068Returned('HX068-5A');
        ContractB := HX068Returned('HX068-5B');
        Partner.HX068SetPreparation('HX068-M5', true, false);
        BindSubscription(Partner);
        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX068-5A', 'HX068-5B');
        Runner.HX068SetFilter(Contract);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'A commit during the preparation does not fail the day close: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.HX068LastPosted(), 'Two contracts are posted');
        Assert.AreEqual(1, HX068MarkerCount('HX068-M5'), 'What the preparation wrote is kept');
        HX068AssertPosted(ContractA, 'Contract A');
        HX068AssertPosted(ContractB, 'Contract B');
    end;

    [Test]
    procedure PreparationWritesKept()
    var
        Contract: Record "CGR Rental Contract";
        Partner: Codeunit "HX068 Close Partner";
        Runner: Codeunit "HX068 Close Runner";
        ContractA: Code[20];
        ContractB: Code[20];
        Ok: Boolean;
    begin
        HX068Init();
        HX068ClearMarker('HX068-M6');
        HX068Vehicle('HX068-6A');
        HX068Vehicle('HX068-6B');
        ContractA := HX068Returned('HX068-6A');
        ContractB := HX068Returned('HX068-6B');
        Partner.HX068SetPreparation('HX068-M6', false, false);
        Partner.HX068FailExport();
        BindSubscription(Partner);
        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX068-6A', 'HX068-6B');
        Runner.HX068SetFilter(Contract);

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A failing export fails the day close');
        Assert.AreEqual(ExportFailedTxt, GetLastErrorText(), 'The day close fails with the export''s error');
        Assert.AreEqual(1, HX068MarkerCount('HX068-M6'), 'What the preparation wrote stays after the failed export');
        HX068AssertPosted(ContractA, 'Contract A stays posted after the failed export:');
        HX068AssertPosted(ContractB, 'Contract B stays posted after the failed export:');
    end;

    [Test]
    procedure PreparationErrorPostsNothing()
    var
        Contract: Record "CGR Rental Contract";
        Partner: Codeunit "HX068 Close Partner";
        Runner: Codeunit "HX068 Close Runner";
        ContractA: Code[20];
        ContractB: Code[20];
        Ok: Boolean;
    begin
        HX068Init();
        HX068Vehicle('HX068-7A');
        HX068Vehicle('HX068-7B');
        ContractA := HX068Returned('HX068-7A');
        ContractB := HX068Returned('HX068-7B');
        Partner.HX068SetPreparation('', false, true);
        BindSubscription(Partner);
        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX068-7A', 'HX068-7B');
        Runner.HX068SetFilter(Contract);

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A failing preparation fails the day close');
        Assert.AreEqual(PreparationFailedTxt, GetLastErrorText(), 'The day close fails with the preparation''s error');
        HX068AssertReturned(ContractA, 'Contract A');
        HX068AssertReturned(ContractB, 'Contract B');
        Assert.AreEqual(0, Partner.HX068ExportCalls(), 'The day is not exported');
    end;

    [Test]
    procedure FailingContractLoggedOthersPosted()
    var
        Contract: Record "CGR Rental Contract";
        PostError: Record "CGR Batch Post Error";
        Partner: Codeunit "HX068 Close Partner";
        Runner: Codeunit "HX068 Close Runner";
        ContractA: Code[20];
        ContractF: Code[20];
        ContractB: Code[20];
        Ok: Boolean;
    begin
        HX068Init();
        HX068Vehicle('HX068-8A');
        HX068Vehicle('HX068-8F');
        HX068Vehicle('HX068-8B');
        ContractA := HX068Returned('HX068-8A');
        ContractF := HX068Returned('HX068-8F');
        ContractB := HX068Returned('HX068-8B');
        Partner.HX068FailPostingFor(ContractF);
        BindSubscription(Partner);
        Contract.SetFilter("Vehicle No.", '%1|%2|%3', 'HX068-8A', 'HX068-8F', 'HX068-8B');
        Runner.HX068SetFilter(Contract);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'A failing contract does not fail the day close: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.HX068LastPosted(), 'Two contracts are posted');
        HX068AssertPosted(ContractA, 'Contract A');
        HX068AssertPosted(ContractB, 'Contract B');
        HX068AssertReturned(ContractF, 'The failing contract');
        Assert.AreEqual(1, HX068ErrorRows(ContractF), 'The failing contract is logged once');
        PostError.SetRange("Contract No.", ContractF);
        PostError.FindFirst();
        Assert.AreEqual(StrSubstNo(SimulatedFailureTxt, ContractF), PostError."Error Message", 'The logged error text');
        Assert.AreEqual(1, Partner.HX068ExportCalls(), 'The day is exported once');
        Assert.AreEqual(2, Partner.HX068ExportedCount(), 'The export gets the number posted');
    end;

    [Test]
    procedure EmptyDayClose()
    var
        Contract: Record "CGR Rental Contract";
        Partner: Codeunit "HX068 Close Partner";
        Runner: Codeunit "HX068 Close Runner";
        Ok: Boolean;
    begin
        HX068Init();
        HX068Vehicle('HX068-9A');
        BindSubscription(Partner);
        Contract.SetRange("Vehicle No.", 'HX068-9A');
        Runner.HX068SetFilter(Contract);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'A day close with nothing to post completes: ' + GetLastErrorText());
        Assert.AreEqual(0, Runner.HX068LastPosted(), 'Nothing is posted');
        Assert.AreEqual(1, Partner.HX068PrepareCalls(), 'The day close is prepared once');
        Assert.AreEqual(1, Partner.HX068ExportCalls(), 'The day is exported once');
        Assert.AreEqual(0, Partner.HX068ExportedCount(), 'The export gets zero posted');
    end;

    [Test]
    procedure OnlyReturnedInFilter()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        Partner: Codeunit "HX068 Close Partner";
        Runner: Codeunit "HX068 Close Runner";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractA: Code[20];
        ContractO: Code[20];
        ContractP: Code[20];
        ContractX: Code[20];
        Ok: Boolean;
    begin
        HX068Init();
        HX068Vehicle('HX068-10A');
        HX068Vehicle('HX068-10O');
        HX068Vehicle('HX068-10P');
        HX068Vehicle('HX068-10X');
        ContractA := HX068Returned('HX068-10A');
        ContractO := RentalMgt.CreateContract('HX068-10O', 'HX068 Customer', 20270301D, 20270303D);
        ContractP := HX068Returned('HX068-10P');
        RentalMgt.Post(ContractP);
        ContractX := HX068Returned('HX068-10X');
        BindSubscription(Partner);
        Contract.SetFilter("Vehicle No.", '%1|%2|%3', 'HX068-10A', 'HX068-10O', 'HX068-10P');
        Runner.HX068SetFilter(Contract);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The day close completes: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.HX068LastPosted(), 'Only the returned contract in the filter is posted');
        HX068AssertPosted(ContractA, 'Contract A');
        Contract.Reset();
        Contract.Get(ContractO);
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'An open contract stays open');
        LedgerEntry.SetRange("Contract No.", ContractO);
        Assert.AreEqual(0, LedgerEntry.Count(), 'An open contract gets no ledger entry');
        HX068AssertPosted(ContractP, 'A contract posted before is not posted again:');
        HX068AssertReturned(ContractX, 'A returned contract outside the filter');
        Assert.AreEqual(1, Partner.HX068ExportedCount(), 'The export gets the number posted');
    end;

    [Test]
    procedure PartnerNarrowsFilter()
    var
        Contract: Record "CGR Rental Contract";
        Partner: Codeunit "HX068 Close Partner";
        Runner: Codeunit "HX068 Close Runner";
        ContractA: Code[20];
        ContractB: Code[20];
        Ok: Boolean;
    begin
        HX068Init();
        HX068Vehicle('HX068-11A');
        HX068Vehicle('HX068-11B');
        ContractA := HX068Returned('HX068-11A');
        ContractB := HX068Returned('HX068-11B');
        Partner.HX068NarrowTo('HX068-11A');
        BindSubscription(Partner);
        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX068-11A', 'HX068-11B');
        Runner.HX068SetFilter(Contract);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The day close completes: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.HX068LastPosted(), 'Only the contract of the narrowed filter is posted');
        HX068AssertPosted(ContractA, 'Contract A');
        HX068AssertReturned(ContractB, 'A contract the partner left out');
        Assert.AreEqual(1, Partner.HX068ExportedCount(), 'The export gets the number posted');
    end;

    local procedure HX068Init()
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

    local procedure HX068Vehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        PostError: Record "CGR Batch Post Error";
        Entry: Record "CGR Outbox Entry";
    begin
        Contract.SetRange("Vehicle No.", VehicleNo);
        if Contract.FindSet() then
            repeat
                PostError.SetRange("Contract No.", Contract."No.");
                PostError.DeleteAll();
            until Contract.Next() = 0;
        Contract.DeleteAll();
        LedgerEntry.SetRange("Vehicle No.", VehicleNo);
        LedgerEntry.DeleteAll();
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle."Daily Rate" := 50;
        Vehicle.Insert();
    end;

    local procedure HX068Returned(VehicleNo: Code[20]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX068 Customer', 20270301D, 20270303D);
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1100, '');
        exit(ContractNo);
    end;

    local procedure HX068ClearMarker(MarkerKey: Code[20])
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Vehicle No.", MarkerKey);
        Entry.DeleteAll();
    end;

    local procedure HX068MarkerCount(MarkerKey: Code[20]): Integer
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Vehicle No.", MarkerKey);
        exit(Entry.Count());
    end;

    local procedure HX068ErrorRows(ContractNo: Code[20]): Integer
    var
        PostError: Record "CGR Batch Post Error";
    begin
        PostError.SetRange("Contract No.", ContractNo);
        exit(PostError.Count());
    end;

    local procedure HX068AssertPosted(ContractNo: Code[20]; What: Text)
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, What + ' is posted');
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, LedgerEntry.Count(), What + ' has one ledger entry');
        LedgerEntry.FindFirst();
        Assert.AreEqual(150.00, LedgerEntry.Amount, What + ' is posted at 3 days x 50');
    end;

    local procedure HX068AssertReturned(ContractNo: Code[20]; What: Text)
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, What + ' stays returned');
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, LedgerEntry.Count(), What + ' has no ledger entry');
    end;
}
