codeunit 80661 "CGR Lease Last Month Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Proposing: Codeunit "CGR Lease Proposing";

    [Test]
    procedure RemovedLastMonthIsProposedAgain()
    var
        Proposal: Record "CGR Lease Proposal Line";
        Contract: Record "CGR Lease Contract";
        ContractNo: Code[20];
    begin
        WorkDate(20270101D);
        ContractNo := LeaseMgt.CreateContract('HX159-V2', 'Quarter Haulage', 20270101D, 3, 1200);
        LeaseMgt.CreateSchedule(ContractNo);

        Assert.AreEqual(3, Proposing.Propose(ContractNo, 20270301D), 'All three months are due');

        Proposal.Get(ContractNo, 30000);
        Proposal.Delete(true);

        Assert.AreEqual(1, Proposing.Propose(ContractNo, 20270301D), 'The removed month comes back');
        Assert.IsTrue(Proposal.Get(ContractNo, 30000), 'March is on the list again');
        Contract.Get(ContractNo);
        Assert.AreEqual(20270301D, Contract."Proposed Through", 'Proposed Through is UpToDate');
    end;
}
