codeunit 80662 "CGR Lease No Post Rewind Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Proposing: Codeunit "CGR Lease Proposing";

    [Test]
    procedure ProposeStopsAtUpToDate()
    var
        Proposal: Record "CGR Lease Proposal Line";
        ContractNo: Code[20];
    begin
        ContractNo := NewLease('Quarter Haulage');
        Assert.AreEqual(2, Proposing.Propose(ContractNo, 20270201D), 'January and February');
        Assert.IsFalse(Proposal.Get(ContractNo, 30000), 'March is not due');
    end;

    [Test]
    procedure RemovedMiddleMonthComesBack()
    var
        Proposal: Record "CGR Lease Proposal Line";
        Contract: Record "CGR Lease Contract";
        ContractNo: Code[20];
    begin
        ContractNo := NewLease('Quarter Haulage');
        Proposing.Propose(ContractNo, 20270301D);
        Proposal.Get(ContractNo, 20000);
        Proposal.Delete(true);
        Contract.Get(ContractNo);
        Assert.AreEqual(20270131D, Contract."Proposed Through", 'Rewound to the day before');

        Assert.AreEqual(1, Proposing.Propose(ContractNo, 20270301D), 'Only the removed month');
        Assert.IsTrue(Proposal.Get(ContractNo, 20000), 'February is back');
    end;

    [Test]
    procedure OtherLeaseOfCustomerUntouched()
    var
        Proposal: Record "CGR Lease Proposal Line";
        Contract: Record "CGR Lease Contract";
        FirstNo: Code[20];
        SecondNo: Code[20];
    begin
        FirstNo := NewLease('Shared Haulage');
        SecondNo := NewLease('Shared Haulage');
        Proposing.Propose(FirstNo, 20270301D);
        Proposing.Propose(SecondNo, 20270301D);
        Proposal.Get(FirstNo, 20000);
        Proposal.Delete(true);
        Contract.Get(SecondNo);
        Assert.AreEqual(20270301D, Contract."Proposed Through", 'The other lease stays');
    end;

    [Test]
    procedure PostedMonthStaysPosted()
    var
        Proposal: Record "CGR Lease Proposal Line";
        Contract: Record "CGR Lease Contract";
        ContractNo: Code[20];
    begin
        ContractNo := NewLease('Quarter Haulage');
        Proposing.Propose(ContractNo, 20270301D);
        Proposing.PostProposal(ContractNo, 20000);
        Contract.Get(ContractNo);
        Assert.AreEqual(20270301D, Contract."Proposed Through", 'Posting does not rewind');
        Assert.AreEqual(0, Proposing.Propose(ContractNo, 20270301D), 'Nothing to propose after posting');
        Assert.IsFalse(Proposal.Get(ContractNo, 20000), 'The posted month is not proposed');
    end;

    local procedure NewLease(CustomerName: Text[100]) ContractNo: Code[20]
    begin
        WorkDate(20270101D);
        ContractNo := LeaseMgt.CreateContract('HX159-V3', CustomerName, 20270101D, 3, 1200);
        LeaseMgt.CreateSchedule(ContractNo);
    end;
}
