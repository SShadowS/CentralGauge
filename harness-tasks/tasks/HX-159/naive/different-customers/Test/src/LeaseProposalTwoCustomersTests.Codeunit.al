codeunit 80663 "CGR Lease Two Customers Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Proposing: Codeunit "CGR Lease Proposing";

    [Test]
    procedure RemovalAndReproposalOnOneLease()
    var
        Proposal: Record "CGR Lease Proposal Line";
        Contract: Record "CGR Lease Contract";
        ContractNo: Code[20];
    begin
        ContractNo := NewLease('Quarter Haulage');
        Assert.AreEqual(2, Proposing.Propose(ContractNo, 20270201D), 'January and February');
        Assert.AreEqual(1, Proposing.Propose(ContractNo, 20270301D), 'March joins');
        Proposal.Get(ContractNo, 20000);
        Proposal.Delete(true);
        Contract.Get(ContractNo);
        Assert.AreEqual(20270131D, Contract."Proposed Through", 'Rewound to the day before');
        Assert.AreEqual(1, Proposing.Propose(ContractNo, 20270301D), 'Only the removed month');
    end;

    [Test]
    procedure OtherCustomerLeaseUntouched()
    var
        Proposal: Record "CGR Lease Proposal Line";
        Contract: Record "CGR Lease Contract";
        FirstNo: Code[20];
        SecondNo: Code[20];
    begin
        FirstNo := NewLease('Northern Haulage');
        SecondNo := NewLease('Southern Haulage');
        Proposing.Propose(FirstNo, 20270301D);
        Proposing.Propose(SecondNo, 20270301D);
        Proposal.Get(FirstNo, 20000);
        Proposal.Delete(true);
        Contract.Get(SecondNo);
        Assert.AreEqual(20270301D, Contract."Proposed Through", 'The other lease stays');
    end;

    [Test]
    procedure PostLeavesProposedThroughAndRewindSkipsPosted()
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
        Proposal.Get(ContractNo, 10000);
        Proposal.Delete(true);
        Assert.AreEqual(1, Proposing.Propose(ContractNo, 20270301D), 'Only January comes back');
        Assert.IsFalse(Proposal.Get(ContractNo, 20000), 'The posted month is not proposed');
    end;

    local procedure NewLease(CustomerName: Text[100]) ContractNo: Code[20]
    begin
        WorkDate(20270101D);
        ContractNo := LeaseMgt.CreateContract('HX159-V4', CustomerName, 20270101D, 3, 1200);
        LeaseMgt.CreateSchedule(ContractNo);
    end;
}
