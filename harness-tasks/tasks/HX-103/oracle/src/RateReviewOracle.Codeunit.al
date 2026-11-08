// Every row sets its own work date and Setup, creates its own leases (numbers from Setup, kept as returned),
// deletes the letters of its own vehicles first, binds its own advisor app, and runs the review through the
// runner after Commit(). Expected schedules are computed here from the CreateSchedule contract, so a perturbed
// CreateSchedule (reuse measurement) cannot also move the expectation.
codeunit 87505 "HX103 Rate Review Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure AcceptedProposalApplied()
    var
        Advisor: Codeunit "HX103 Advisor App";
        L1: Code[20];
        Result: Integer;
    begin
        HX103Prepare();
        L1 := HX103NewLease('HX103-1', 1000);
        Advisor.HX103Propose(L1, 1050, false, false);
        BindSubscription(Advisor);

        Assert.IsTrue(HX103RunReview(L1, Result), StrSubstNo('The review succeeds: %1', GetLastErrorText()));

        Assert.AreEqual(1, Result, 'One accepted lease');
        HX103AssertRate(L1, 1050);
        HX103AssertScheduleFor(L1, 1050);
        HX103AssertLetters('HX103-1', 1);
    end;

    [Test]
    procedure DeclinedProposalKeepsNoLetter()
    var
        Advisor: Codeunit "HX103 Advisor App";
        L2: Code[20];
        Result: Integer;
    begin
        HX103Prepare();
        L2 := HX103NewLease('HX103-2', 1000);
        Advisor.HX103Propose(L2, 1200, false, false);
        BindSubscription(Advisor);

        Assert.IsTrue(HX103RunReview(L2, Result), StrSubstNo('The review succeeds: %1', GetLastErrorText()));

        Assert.AreEqual(0, Result, 'A proposal 20% above the rate is declined');
        HX103AssertRate(L2, 1000);
        HX103AssertScheduleFor(L2, 1000);
        HX103AssertLetters('HX103-2', 0);
    end;

    [Test]
    procedure MixedLeasesReviewedOnTheirOwn()
    var
        Advisor: Codeunit "HX103 Advisor App";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        L3a, L3b, L3c, L3d, L3e : Code[20];
        Result: Integer;
    begin
        HX103Prepare();
        L3a := HX103NewLease('HX103-3A', 1000);
        L3b := HX103NewLease('HX103-3B', 1000);
        L3c := HX103NewLease('HX103-3C', 1000);
        L3d := HX103NewLease('HX103-3D', 1250);
        L3e := HX103NewLease('HX103-3E', 1000);
        LeaseMgt.InvoiceLine(L3c, 10000);
        Advisor.HX103Propose(L3a, 1050, false, false);
        Advisor.HX103Propose(L3b, 0, false, false);
        Advisor.HX103Propose(L3c, 1050, false, false);
        Advisor.HX103Propose(L3d, 1150, false, false);
        Advisor.HX103Propose(L3e, 1100, false, false);
        BindSubscription(Advisor);

        Assert.IsTrue(
            HX103RunReview(StrSubstNo('%1|%2|%3|%4|%5', L3a, L3b, L3c, L3d, L3e), Result),
            StrSubstNo('The review succeeds: %1', GetLastErrorText()));

        Assert.AreEqual(3, Result, 'Three accepted leases: +5%, -8% and exactly +10%');
        HX103AssertRate(L3a, 1050);
        HX103AssertScheduleFor(L3a, 1050);
        HX103AssertLetters('HX103-3A', 1);
        HX103AssertRate(L3b, 1000);
        HX103AssertScheduleFor(L3b, 1000);
        HX103AssertLetters('HX103-3B', 0);
        HX103AssertRate(L3c, 1000);
        HX103AssertScheduleFor(L3c, 1000);
        HX103AssertInvoiced(L3c, 10000, true);
        HX103AssertInvoiced(L3c, 20000, false);
        HX103AssertLetters('HX103-3C', 0);
        HX103AssertRate(L3d, 1150);
        HX103AssertScheduleFor(L3d, 1150);
        HX103AssertLetters('HX103-3D', 1);
        HX103AssertRate(L3e, 1100);
        HX103AssertScheduleFor(L3e, 1100);
        HX103AssertLetters('HX103-3E', 1);
    end;

    [Test]
    procedure CommittingAdvisorDeclinedKeepsNothing()
    var
        Advisor: Codeunit "HX103 Advisor App";
        L4: Code[20];
        Result: Integer;
    begin
        HX103Prepare();
        L4 := HX103NewLease('HX103-4', 1000);
        Advisor.HX103Propose(L4, 1500, true, false);
        BindSubscription(Advisor);

        Assert.IsTrue(HX103RunReview(L4, Result), StrSubstNo('The review succeeds: %1', GetLastErrorText()));

        Assert.AreEqual(0, Result, 'A proposal 50% above the rate is declined');
        HX103AssertRate(L4, 1000);
        HX103AssertScheduleFor(L4, 1000);
        HX103AssertLetters('HX103-4', 0);
    end;

    [Test]
    procedure CommittingAdvisorAcceptedKeepsLetter()
    var
        Advisor: Codeunit "HX103 Advisor App";
        L5: Code[20];
        Result: Integer;
    begin
        HX103Prepare();
        L5 := HX103NewLease('HX103-5', 1000);
        Advisor.HX103Propose(L5, 980, true, false);
        BindSubscription(Advisor);

        Assert.IsTrue(HX103RunReview(L5, Result), StrSubstNo('The review succeeds: %1', GetLastErrorText()));

        Assert.AreEqual(1, Result, 'One accepted lease');
        HX103AssertRate(L5, 980);
        HX103AssertScheduleFor(L5, 980);
        HX103AssertLetters('HX103-5', 1);
    end;

    [Test]
    procedure FailingAdvisorDoesNotStopReview()
    var
        Advisor: Codeunit "HX103 Advisor App";
        L6a, L6b : Code[20];
        Result: Integer;
    begin
        HX103Prepare();
        L6a := HX103NewLease('HX103-6A', 1000);
        L6b := HX103NewLease('HX103-6B', 1000);
        Advisor.HX103Propose(L6a, 1030, false, true);
        Advisor.HX103Propose(L6b, 1020, false, false);
        BindSubscription(Advisor);

        Assert.IsTrue(HX103RunReview(StrSubstNo('%1|%2', L6a, L6b), Result), StrSubstNo('The review succeeds: %1', GetLastErrorText()));

        Assert.AreEqual(1, Result, 'Only the lease whose advisor did not fail is accepted');
        HX103AssertRate(L6a, 1000);
        HX103AssertScheduleFor(L6a, 1000);
        HX103AssertLetters('HX103-6A', 0);
        HX103AssertRate(L6b, 1020);
        HX103AssertScheduleFor(L6b, 1020);
        HX103AssertLetters('HX103-6B', 1);
    end;

    [Test]
    procedure EqualRateCounts()
    var
        Advisor: Codeunit "HX103 Advisor App";
        L7: Code[20];
        Result: Integer;
    begin
        HX103Prepare();
        L7 := HX103NewLease('HX103-7', 1000);
        Advisor.HX103Propose(L7, 1000, false, false);
        BindSubscription(Advisor);

        Assert.IsTrue(HX103RunReview(L7, Result), StrSubstNo('The review succeeds: %1', GetLastErrorText()));

        Assert.AreEqual(1, Result, 'A proposal equal to the rate is accepted');
        HX103AssertRate(L7, 1000);
        HX103AssertScheduleFor(L7, 1000);
        HX103AssertLetters('HX103-7', 1);
    end;

    [Test]
    procedure LeaseOutsideFilterUntouched()
    var
        Advisor: Codeunit "HX103 Advisor App";
        L8a, L8b : Code[20];
        Result: Integer;
    begin
        HX103Prepare();
        L8a := HX103NewLease('HX103-8A', 1000);
        L8b := HX103NewLease('HX103-8B', 1000);
        Advisor.HX103Propose(L8a, 1050, false, false);
        Advisor.HX103Propose(L8b, 1050, false, false);
        BindSubscription(Advisor);

        Assert.IsTrue(HX103RunReview(L8a, Result), StrSubstNo('The review succeeds: %1', GetLastErrorText()));

        Assert.AreEqual(1, Result, 'Only the lease in the filter is reviewed and counted');
        HX103AssertRate(L8a, 1050);
        HX103AssertScheduleFor(L8a, 1050);
        HX103AssertLetters('HX103-8A', 1);
        HX103AssertRate(L8b, 1000);
        HX103AssertScheduleFor(L8b, 1000);
        HX103AssertLetters('HX103-8B', 0);
    end;

    [Test]
    procedure LowerBandEdge()
    var
        Advisor: Codeunit "HX103 Advisor App";
        L9a, L9b : Code[20];
        Result: Integer;
    begin
        HX103Prepare();
        L9a := HX103NewLease('HX103-9A', 1000);
        L9b := HX103NewLease('HX103-9B', 1000);
        Advisor.HX103Propose(L9a, 850, false, false);
        Advisor.HX103Propose(L9b, 900, false, false);
        BindSubscription(Advisor);

        Assert.IsTrue(HX103RunReview(StrSubstNo('%1|%2', L9a, L9b), Result), StrSubstNo('The review succeeds: %1', GetLastErrorText()));

        Assert.AreEqual(1, Result, 'A proposal 15% below the rate is declined, exactly 10% below is accepted');
        HX103AssertRate(L9a, 1000);
        HX103AssertScheduleFor(L9a, 1000);
        HX103AssertLetters('HX103-9A', 0);
        HX103AssertRate(L9b, 900);
        HX103AssertScheduleFor(L9b, 900);
        HX103AssertLetters('HX103-9B', 1);
    end;

    local procedure HX103Prepare()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270115D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := 3;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure HX103NewLease(VehicleNo: Code[20]; BaseRate: Decimal): Code[20]
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseNo: Code[20];
    begin
        HX103ClearLetters(VehicleNo);
        LeaseNo := LeaseMgt.CreateContract(VehicleNo, 'HX103 Customer', 20270301D, 12, BaseRate);
        LeaseMgt.CreateSchedule(LeaseNo);
        exit(LeaseNo);
    end;

    local procedure HX103RunReview(LeaseNoFilter: Text; var Result: Integer): Boolean
    var
        Runner: Codeunit "HX103 Review Runner";
        Ok: Boolean;
    begin
        Commit();
        Runner.HX103SetLeases(LeaseNoFilter);
        Ok := Runner.Run();
        Result := Runner.HX103Result();
        exit(Ok);
    end;

    local procedure HX103ClearLetters(VehicleNo: Code[20])
    var
        Letter: Record "CGR Outbox Entry";
    begin
        Letter.SetRange("Event Type", 'HX103 letter');
        Letter.SetRange("Vehicle No.", VehicleNo);
        Letter.DeleteAll();
    end;

    local procedure HX103AssertLetters(VehicleNo: Code[20]; Expected: Integer)
    var
        Letter: Record "CGR Outbox Entry";
    begin
        Letter.SetRange("Event Type", 'HX103 letter');
        Letter.SetRange("Vehicle No.", VehicleNo);
        Assert.AreEqual(Expected, Letter.Count(), StrSubstNo('Advisor letters kept for %1', VehicleNo));
    end;

    local procedure HX103AssertRate(LeaseNo: Code[20]; Expected: Decimal)
    var
        Lease: Record "CGR Lease Contract";
    begin
        Lease.Get(LeaseNo);
        Assert.AreEqual(Expected, Lease."Base Rate", StrSubstNo('Base Rate of lease %1', LeaseNo));
    end;

    local procedure HX103AssertInvoiced(LeaseNo: Code[20]; LineNo: Integer; Expected: Boolean)
    var
        Line: Record "CGR Lease Schedule Line";
    begin
        Line.Get(LeaseNo, LineNo);
        Assert.AreEqual(Expected, Line.Invoiced, StrSubstNo('Invoiced of lease %1 line %2', LeaseNo, LineNo));
    end;

    // The schedule CGR Lease Mgt.CreateSchedule creates: LeaseTotal = Round(Rate * (1 + Months / 100) * Months, 0.01),
    // split into Months installments of Round(Total / Months, 0.01) with the remainder on the last, due monthly
    // from the start date, line numbers 10000, 20000, ...
    local procedure HX103AssertScheduleFor(LeaseNo: Code[20]; Rate: Decimal)
    var
        Lease: Record "CGR Lease Contract";
        Line: Record "CGR Lease Schedule Line";
        Total: Decimal;
        Installment: Decimal;
        Expected: Decimal;
        i: Integer;
    begin
        Lease.Get(LeaseNo);
        Total := Round(Rate * (1 + Lease.Months / 100) * Lease.Months, 0.01);
        Installment := Round(Total / Lease.Months, 0.01);
        Line.SetRange("Contract No.", LeaseNo);
        Assert.AreEqual(Lease.Months, Line.Count(), StrSubstNo('Schedule lines of lease %1', LeaseNo));
        for i := 1 to Lease.Months do begin
            Line.Get(LeaseNo, i * 10000);
            if i < Lease.Months then
                Expected := Installment
            else
                Expected := Total - Installment * (Lease.Months - 1);
            Assert.AreEqual(CalcDate(StrSubstNo('<+%1M>', i - 1), Lease."Start Date"), Line."Due Date", StrSubstNo('Due Date of lease %1 line %2', LeaseNo, i * 10000));
            Assert.AreEqual(Expected, Line.Amount, StrSubstNo('Amount of lease %1 line %2 at rate %3', LeaseNo, i * 10000, Rate));
        end;
    end;
}
