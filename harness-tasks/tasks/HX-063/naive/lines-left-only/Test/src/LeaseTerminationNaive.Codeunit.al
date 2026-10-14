codeunit 80112 "CGR Lease Termination Naive"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure TerminationDeletesLaterLines()
    var
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Termination: Codeunit "CGR Lease Termination";
        ContractNo: Code[20];
    begin
        Lib.SetV2Setup(0.01, '', 3);
        ContractNo := Lib.CreateLease('HX063-N01', 20270115D, 6, 100);
        LeaseMgt.CreateSchedule(ContractNo);

        Termination.TerminateLease(ContractNo, 20270420D);

        Line.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(4, Line.Count(), 'Four lines are left');
    end;
}
