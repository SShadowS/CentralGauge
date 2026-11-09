codeunit 80660 "CGR Lease Proposal Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Proposing: Codeunit "CGR Lease Proposing";

    [Test]
    procedure ProposeIncludesLineDueOnUpToDate()
    var
        Proposal: Record "CGR Lease Proposal Line";
        Contract: Record "CGR Lease Contract";
        ContractNo: Code[20];
    begin
        ContractNo := NewLease('Quarter Haulage');

        Assert.AreEqual(2, Proposing.Propose(ContractNo, 20270201D), 'January and February are due by 1 February');

        Assert.IsTrue(Proposal.Get(ContractNo, 20000), 'The line due exactly on UpToDate is proposed');
        Assert.IsFalse(Proposal.Get(ContractNo, 30000), 'March is not due yet');
        Contract.Get(ContractNo);
        Assert.AreEqual(20270201D, Contract."Proposed Through", 'Proposed Through follows UpToDate');
    end;

    [Test]
    procedure EarlierProposeKeepsProposedThrough()
    var
        Contract: Record "CGR Lease Contract";
        ContractNo: Code[20];
    begin
        ContractNo := NewLease('Quarter Haulage');
        Proposing.Propose(ContractNo, 20270301D);

        Assert.AreEqual(0, Proposing.Propose(ContractNo, 20270201D), 'Nothing new is due');

        Contract.Get(ContractNo);
        Assert.AreEqual(20270301D, Contract."Proposed Through", 'A later Proposed Through stays');
    end;

    [Test]
    procedure RemovedLineIsProposedAgain()
    var
        Proposal: Record "CGR Lease Proposal Line";
        Contract: Record "CGR Lease Contract";
        ContractNo: Code[20];
    begin
        ContractNo := NewLease('Quarter Haulage');
        Proposing.Propose(ContractNo, 20270301D);
        RemoveLine(ContractNo, 20000);

        Assert.AreEqual(1, Proposing.Propose(ContractNo, 20270301D), 'Only the removed month is written again');

        Assert.IsTrue(Proposal.Get(ContractNo, 20000), 'The removed month is back on the list');
        Assert.AreEqual(20270201D, Proposal."Due Date", 'The line carries its due date');
        Contract.Get(ContractNo);
        Assert.AreEqual(20270301D, Contract."Proposed Through", 'Proposed Through is UpToDate again');
    end;

    [Test]
    procedure RemovalRewindsToTheDayBefore()
    var
        Contract: Record "CGR Lease Contract";
        ContractNo: Code[20];
    begin
        ContractNo := NewLease('Quarter Haulage');
        Proposing.Propose(ContractNo, 20270301D);

        RemoveLine(ContractNo, 20000);

        Contract.Get(ContractNo);
        Assert.AreEqual(20270131D, Contract."Proposed Through", 'The day before the removed line is due');
    end;

    [Test]
    procedure RemovalKeepsEarlierProposedThrough()
    var
        Contract: Record "CGR Lease Contract";
        ContractNo: Code[20];
    begin
        ContractNo := NewLease('Quarter Haulage');
        Proposing.Propose(ContractNo, 20270301D);
        RemoveLine(ContractNo, 10000);
        Contract.Get(ContractNo);
        Assert.AreEqual(20261231D, Contract."Proposed Through", 'Rewound to the day before January');

        RemoveLine(ContractNo, 30000);

        Contract.Get(ContractNo);
        Assert.AreEqual(20261231D, Contract."Proposed Through", 'A later month does not move an earlier date');
    end;

    [Test]
    procedure RemovalLeavesOtherLeaseOfCustomer()
    var
        Contract: Record "CGR Lease Contract";
        FirstNo: Code[20];
        SecondNo: Code[20];
    begin
        FirstNo := NewLease('Shared Haulage');
        SecondNo := NewLease('Shared Haulage');
        Proposing.Propose(FirstNo, 20270301D);
        Proposing.Propose(SecondNo, 20270301D);

        RemoveLine(FirstNo, 20000);

        Contract.Get(SecondNo);
        Assert.AreEqual(20270301D, Contract."Proposed Through", 'The other lease of the customer is untouched');
        Contract.Get(FirstNo);
        Assert.AreEqual(20270131D, Contract."Proposed Through", 'The removed line rewinds its own lease');
    end;

    [Test]
    procedure PostKeepsProposedThrough()
    var
        Proposal: Record "CGR Lease Proposal Line";
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        ContractNo: Code[20];
    begin
        ContractNo := NewLease('Quarter Haulage');
        Proposing.Propose(ContractNo, 20270301D);

        Proposing.PostProposal(ContractNo, 20000);

        Contract.Get(ContractNo);
        Assert.AreEqual(20270301D, Contract."Proposed Through", 'Posting leaves Proposed Through as it is');
        ScheduleLine.Get(ContractNo, 20000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'The schedule line is invoiced');
        Assert.IsFalse(Proposal.Get(ContractNo, 20000), 'The posted line is off the list');
    end;

    [Test]
    procedure RewindBehindPostedMonthSkipsIt()
    var
        Proposal: Record "CGR Lease Proposal Line";
        ContractNo: Code[20];
    begin
        ContractNo := NewLease('Quarter Haulage');
        Proposing.Propose(ContractNo, 20270301D);
        Proposing.PostProposal(ContractNo, 20000);
        RemoveLine(ContractNo, 10000);

        Assert.AreEqual(1, Proposing.Propose(ContractNo, 20270301D), 'Only January comes back');

        Assert.IsTrue(Proposal.Get(ContractNo, 10000), 'January is on the list again');
        Assert.IsFalse(Proposal.Get(ContractNo, 20000), 'A posted month is never proposed again');
    end;

    local procedure NewLease(CustomerName: Text[100]) ContractNo: Code[20]
    begin
        WorkDate(20270101D);
        ContractNo := LeaseMgt.CreateContract('HX159-V1', CustomerName, 20270101D, 3, 1200);
        LeaseMgt.CreateSchedule(ContractNo);
    end;

    local procedure RemoveLine(ContractNo: Code[20]; ScheduleLineNo: Integer)
    var
        Proposal: Record "CGR Lease Proposal Line";
    begin
        Proposal.Get(ContractNo, ScheduleLineNo);
        Proposal.Delete(true);
    end;
}
