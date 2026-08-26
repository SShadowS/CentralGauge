codeunit 89319 "CG-AL-X125 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        QuestionTxt: Label 'Refund request %1 needs approval before release. Release it anyway?', Locked = true;
        AskCount: Integer;
        SeenQuestion: Text;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears its tables
    // before seeding its own rows.
    //
    // A test expecting a dialog declares a [ConfirmHandler] and counts
    // invocations via AskCount, since a declared handler that never fires
    // fails the test on its own (measured 2026-08-26, decisions entry 27,
    // scratch/probe-batch6g/). A test expecting NO dialog therefore
    // declares NO handler at all - if the code under test raises one
    // anyway, there is nothing to answer it and the test fails on that
    // alone. Do not "fix" a silent-path test by adding a handler back;
    // that is exactly the shape that broke it.

    local procedure ClearAllData()
    var
        Req: Record "CG X125 Refund Request";
        History: Record "CG X125 Customer History";
        DeclineLogRec: Record "CG X125 Decline Log";
    begin
        Req.DeleteAll();
        History.DeleteAll();
        DeclineLogRec.DeleteAll();
    end;

    local procedure SetDeclinedCount(CustomerNo: Code[20]; DeclinedCount: Integer)
    var
        History: Record "CG X125 Customer History";
    begin
        if History.Get(CustomerNo) then begin
            History."Declined Count" := DeclinedCount;
            History.Modify();
        end else begin
            History.Init();
            History."Customer No." := CustomerNo;
            History."Declined Count" := DeclinedCount;
            History.Insert();
        end;
    end;

    local procedure SeedRequest(EntryNo: Integer; CustomerNo: Code[20]; Amount: Integer; ManualOverridesSentinel: Integer)
    var
        Req: Record "CG X125 Refund Request";
    begin
        Req.Init();
        Req."Entry No." := EntryNo;
        Req."Customer No." := CustomerNo;
        Req.Amount := Amount;
        Req.Status := Req.Status::Open;
        Req."Manual Overrides" := ManualOverridesSentinel;
        Req.Insert();
    end;

    local procedure DeclineLogCount(): Integer
    var
        DeclineLogRec: Record "CG X125 Decline Log";
    begin
        exit(DeclineLogRec.Count());
    end;

    local procedure AssertNoNewDecline(PriorCount: Integer; Context: Text)
    begin
        Assert.AreEqual(PriorCount, DeclineLogCount(), StrSubstNo('%1: expected no decline to be recorded', Context));
    end;

    local procedure AssertOneNewDecline(PriorCount: Integer; ExpectedCustomerNo: Code[20]; ExpectedAmount: Integer; Context: Text)
    var
        DeclineLogRec: Record "CG X125 Decline Log";
    begin
        Assert.AreEqual(PriorCount + 1, DeclineLogCount(), StrSubstNo('%1: expected exactly one new decline to be recorded', Context));
        DeclineLogRec.Reset();
        Assert.IsTrue(DeclineLogRec.FindLast(), StrSubstNo('%1: expected a decline record to exist', Context));
        Assert.AreEqual(ExpectedCustomerNo, DeclineLogRec."Customer No.", StrSubstNo('%1: unexpected customer on the recorded decline', Context));
        Assert.AreEqual(ExpectedAmount, DeclineLogRec.Amount, StrSubstNo('%1: unexpected amount on the recorded decline', Context));
    end;

    [Test]
    procedure RequestFromCustomerAForFourHundredReleasesWithoutAsking()
    var
        Req: Record "CG X125 Refund Request";
        Releaser: Codeunit "CG X125 Refund Releaser";
        Released: Boolean;
        PriorDeclines: Integer;
    begin
        // No [HandlerFunctions] declared - a dialog raised here has nothing
        // to answer it and fails the test on its own (entry 27).
        ClearAllData();
        SeedRequest(1, 'CUST-A', 400, 3);
        Req.Get(1);
        PriorDeclines := DeclineLogCount();

        Released := Releaser.ReleaseRefund(Req);

        Assert.IsTrue(Released, 'Expected the request to release');
        Req.Get(1);
        Assert.IsTrue(Req.Status = Req.Status::Released,
            StrSubstNo('Expected the request to be Released, got status %1', Req.Status));
        Assert.AreEqual(3, Req."Manual Overrides", 'Expected the override count to stay unchanged');
        AssertNoNewDecline(PriorDeclines, 'CustomerA/400');
    end;

    [Test]
    [HandlerFunctions('ConfirmYes')]
    procedure RequestFromCustomerAForEightHundredReleasesAfterYes()
    var
        Req: Record "CG X125 Refund Request";
        Releaser: Codeunit "CG X125 Refund Releaser";
        Released: Boolean;
        PriorDeclines: Integer;
    begin
        ClearAllData();
        SeedRequest(2, 'CUST-A', 800, 3);
        Req.Get(2);
        AskCount := 0;
        SeenQuestion := '';
        PriorDeclines := DeclineLogCount();

        Released := Releaser.ReleaseRefund(Req);

        Assert.AreEqual(1, AskCount, 'Expected exactly one confirmation question for this request');
        Assert.AreEqual(StrSubstNo(QuestionTxt, 2), SeenQuestion, 'Expected the question text to match exactly, with this request''s own entry number');
        Assert.IsTrue(Released, 'Expected the request to release');
        Req.Get(2);
        Assert.IsTrue(Req.Status = Req.Status::Released,
            StrSubstNo('Expected the request to be Released, got status %1', Req.Status));
        Assert.AreEqual(4, Req."Manual Overrides", 'Expected the override count to increase by one');
        AssertNoNewDecline(PriorDeclines, 'CustomerA/800/Yes');
    end;

    [Test]
    [HandlerFunctions('ConfirmNo')]
    procedure RequestFromCustomerAForEightHundredStaysOpenAfterNo()
    var
        Req: Record "CG X125 Refund Request";
        Releaser: Codeunit "CG X125 Refund Releaser";
        Released: Boolean;
        PriorDeclines: Integer;
    begin
        ClearAllData();
        SeedRequest(3, 'CUST-A', 800, 3);
        Req.Get(3);
        AskCount := 0;
        SeenQuestion := '';
        PriorDeclines := DeclineLogCount();

        Released := Releaser.ReleaseRefund(Req);

        Assert.AreEqual(1, AskCount, 'Expected exactly one confirmation question for this request');
        Assert.AreEqual(StrSubstNo(QuestionTxt, 3), SeenQuestion, 'Expected the question text to match exactly, with this request''s own entry number');
        Assert.IsFalse(Released, 'Expected the request to stay unreleased');
        Req.Get(3);
        Assert.IsTrue(Req.Status = Req.Status::Open,
            StrSubstNo('Expected the request to stay Open, got status %1', Req.Status));
        Assert.AreEqual(3, Req."Manual Overrides", 'Expected the override count to stay unchanged');
        AssertOneNewDecline(PriorDeclines, 'CUST-A', 800, 'CustomerA/800/No');
    end;

    [Test]
    [HandlerFunctions('ConfirmYes')]
    procedure RequestFromCustomerBForFiftyReleasesAfterYes()
    var
        Req: Record "CG X125 Refund Request";
        Releaser: Codeunit "CG X125 Refund Releaser";
        Released: Boolean;
        PriorDeclines: Integer;
    begin
        ClearAllData();
        SetDeclinedCount('CUST-B', 1);
        SeedRequest(4, 'CUST-B', 50, 3);
        Req.Get(4);
        AskCount := 0;
        SeenQuestion := '';
        PriorDeclines := DeclineLogCount();

        Released := Releaser.ReleaseRefund(Req);

        Assert.AreEqual(1, AskCount, 'Expected exactly one confirmation question for this request');
        Assert.AreEqual(StrSubstNo(QuestionTxt, 4), SeenQuestion, 'Expected the question text to match exactly, with this request''s own entry number');
        Assert.IsTrue(Released, 'Expected the request to release');
        Req.Get(4);
        Assert.IsTrue(Req.Status = Req.Status::Released,
            StrSubstNo('Expected the request to be Released, got status %1', Req.Status));
        Assert.AreEqual(4, Req."Manual Overrides", 'Expected the override count to increase by one');
        AssertNoNewDecline(PriorDeclines, 'CustomerB/50/Yes');
    end;

    [Test]
    procedure ReleasingOneRequestDoesNotAffectAnUnrelatedRequest()
    var
        Req: Record "CG X125 Refund Request";
        Other: Record "CG X125 Refund Request";
        Releaser: Codeunit "CG X125 Refund Releaser";
        Released: Boolean;
    begin
        // No [HandlerFunctions] declared - a dialog raised here has nothing
        // to answer it and fails the test on its own (entry 27).
        ClearAllData();
        SetDeclinedCount('CUST-C', 1);
        SeedRequest(10, 'CUST-A', 200, 3);
        SeedRequest(11, 'CUST-C', 900, 5);
        Req.Get(10);

        Released := Releaser.ReleaseRefund(Req);

        Assert.IsTrue(Released, 'Expected the targeted request to release');
        Req.Get(10);
        Assert.IsTrue(Req.Status = Req.Status::Released,
            StrSubstNo('Expected the targeted request to be Released, got status %1', Req.Status));
        Assert.AreEqual(3, Req."Manual Overrides", 'Expected the targeted request''s override count to stay unchanged');

        Other.Get(11);
        Assert.IsTrue(Other.Status = Other.Status::Open,
            StrSubstNo('Expected the unrelated request to stay Open, got status %1', Other.Status));
        Assert.AreEqual(900, Other.Amount, 'Expected the unrelated request''s amount to be untouched');
        Assert.AreEqual('CUST-C', Other."Customer No.", 'Expected the unrelated request''s customer to be untouched');
        Assert.AreEqual(5, Other."Manual Overrides", 'Expected the unrelated request''s override count to be untouched');
    end;

    [Test]
    [HandlerFunctions('ConfirmYes')]
    procedure ReleasingAnAskedRequestDoesNotAffectAnUnrelatedRequest()
    var
        Req: Record "CG X125 Refund Request";
        Other: Record "CG X125 Refund Request";
        Releaser: Codeunit "CG X125 Refund Releaser";
        Released: Boolean;
    begin
        ClearAllData();
        SetDeclinedCount('CUST-D', 1);
        SeedRequest(20, 'CUST-D', 700, 3);
        SeedRequest(21, 'CUST-D', 300, 6);
        Req.Get(20);
        AskCount := 0;

        Released := Releaser.ReleaseRefund(Req);

        Assert.AreEqual(1, AskCount, 'Expected exactly one confirmation question for this request');
        Assert.IsTrue(Released, 'Expected the targeted request to release');
        Req.Get(20);
        Assert.IsTrue(Req.Status = Req.Status::Released,
            StrSubstNo('Expected the targeted request to be Released, got status %1', Req.Status));
        Assert.AreEqual(4, Req."Manual Overrides", 'Expected the targeted request''s override count to increase by one');

        Other.Get(21);
        Assert.IsTrue(Other.Status = Other.Status::Open,
            StrSubstNo('Expected the unrelated request to stay Open, got status %1', Other.Status));
        Assert.AreEqual(300, Other.Amount, 'Expected the unrelated request''s amount to be untouched');
        Assert.AreEqual('CUST-D', Other."Customer No.", 'Expected the unrelated request''s customer to be untouched');
        Assert.AreEqual(6, Other."Manual Overrides", 'Expected the unrelated request''s override count to be untouched');
    end;

    [Test]
    [HandlerFunctions('ConfirmYes')]
    procedure ReleaseRefundHandlesManyRequestsAnsweredYes()
    var
        Req: Record "CG X125 Refund Request";
        Releaser: Codeunit "CG X125 Refund Releaser";
        Amounts: List of [Integer];
        DeclinedCounts: List of [Integer];
        Amount: Integer;
        DeclinedCount: Integer;
        EntryNo: Integer;
        ExpectAsk: Boolean;
        Released: Boolean;
        ExpectedOverrides: Integer;
        PriorDeclines: Integer;
        Context: Text;
    begin
        ClearAllData();
        Amounts.Add(0);
        Amounts.Add(1);
        Amounts.Add(100);
        Amounts.Add(300);
        Amounts.Add(499);
        Amounts.Add(500);
        Amounts.Add(501);
        Amounts.Add(502);
        Amounts.Add(1000);
        Amounts.Add(10000);
        DeclinedCounts.Add(0);
        DeclinedCounts.Add(1);
        DeclinedCounts.Add(4);

        EntryNo := 100;
        foreach DeclinedCount in DeclinedCounts do
            foreach Amount in Amounts do begin
                EntryNo += 1;
                SetDeclinedCount('CUST-SWEEP', DeclinedCount);
                SeedRequest(EntryNo, 'CUST-SWEEP', Amount, 3);
                Req.Get(EntryNo);
                AskCount := 0;
                SeenQuestion := '';
                PriorDeclines := DeclineLogCount();
                Context := StrSubstNo('entry %1', EntryNo);

                ExpectAsk := (Amount > 500) or (DeclinedCount > 0);

                Released := Releaser.ReleaseRefund(Req);

                if ExpectAsk then
                    Assert.AreEqual(1, AskCount, StrSubstNo('%1: expected exactly one confirmation question', Context))
                else
                    Assert.AreEqual(0, AskCount, StrSubstNo('%1: expected no confirmation question', Context));

                Assert.IsTrue(Released, StrSubstNo('%1: expected the request to release', Context));

                Req.Get(EntryNo);
                Assert.IsTrue(Req.Status = Req.Status::Released,
                    StrSubstNo('%1: expected the request to be Released, got status %2', Context, Req.Status));

                if ExpectAsk then begin
                    Assert.AreEqual(StrSubstNo(QuestionTxt, EntryNo), SeenQuestion,
                        StrSubstNo('%1: expected the question text to match exactly', Context));
                    ExpectedOverrides := 4;
                end else
                    ExpectedOverrides := 3;

                Assert.AreEqual(ExpectedOverrides, Req."Manual Overrides",
                    StrSubstNo('%1: expected override count %2 but got %3', Context, ExpectedOverrides, Req."Manual Overrides"));

                AssertNoNewDecline(PriorDeclines, Context);
            end;
    end;

    [Test]
    [HandlerFunctions('ConfirmNo')]
    procedure ReleaseRefundHandlesManyRequestsAnsweredNo()
    var
        Req: Record "CG X125 Refund Request";
        Releaser: Codeunit "CG X125 Refund Releaser";
        Amounts: List of [Integer];
        DeclinedCounts: List of [Integer];
        Amount: Integer;
        DeclinedCount: Integer;
        EntryNo: Integer;
        ExpectAsk: Boolean;
        Released: Boolean;
        PriorDeclines: Integer;
        Context: Text;
    begin
        ClearAllData();
        Amounts.Add(0);
        Amounts.Add(1);
        Amounts.Add(50);
        Amounts.Add(499);
        Amounts.Add(501);
        Amounts.Add(502);
        Amounts.Add(600);
        Amounts.Add(5000);
        DeclinedCounts.Add(0);
        DeclinedCounts.Add(1);
        DeclinedCounts.Add(4);

        EntryNo := 200;
        foreach DeclinedCount in DeclinedCounts do
            foreach Amount in Amounts do begin
                ExpectAsk := (Amount > 500) or (DeclinedCount > 0);
                if ExpectAsk then begin
                    EntryNo += 1;
                    SetDeclinedCount('CUST-SWEEP-NO', DeclinedCount);
                    SeedRequest(EntryNo, 'CUST-SWEEP-NO', Amount, 3);
                    Req.Get(EntryNo);
                    AskCount := 0;
                    SeenQuestion := '';
                    PriorDeclines := DeclineLogCount();
                    Context := StrSubstNo('entry %1', EntryNo);

                    Released := Releaser.ReleaseRefund(Req);

                    Assert.AreEqual(1, AskCount, StrSubstNo('%1: expected exactly one confirmation question', Context));
                    Assert.AreEqual(StrSubstNo(QuestionTxt, EntryNo), SeenQuestion,
                        StrSubstNo('%1: expected the question text to match exactly', Context));
                    Assert.IsFalse(Released, StrSubstNo('%1: expected the request to stay unreleased', Context));

                    Req.Get(EntryNo);
                    Assert.IsTrue(Req.Status = Req.Status::Open,
                        StrSubstNo('%1: expected the request to stay Open, got status %2', Context, Req.Status));
                    Assert.AreEqual(3, Req."Manual Overrides",
                        StrSubstNo('%1: expected the override count to stay unchanged', Context));

                    AssertOneNewDecline(PriorDeclines, 'CUST-SWEEP-NO', Amount, Context);
                end;
            end;
    end;

    [ConfirmHandler]
    procedure ConfirmYes(Question: Text[1024]; var Reply: Boolean)
    begin
        AskCount += 1;
        SeenQuestion := Question;
        Reply := true;
    end;

    [ConfirmHandler]
    procedure ConfirmNo(Question: Text[1024]; var Reply: Boolean)
    begin
        AskCount += 1;
        SeenQuestion := Question;
        Reply := false;
    end;
}
