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

    [Test]
    procedure TerminationOnDueDateReprices()
    var
        Contract: Record "CGR Lease Contract";
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Termination: Codeunit "CGR Lease Termination";
        ContractNo: Code[20];
    begin
        Lib.SetV2Setup(0.01, '', 3);
        ContractNo := Lib.CreateLease('HX063-N02', 20270115D, 6, 100);
        LeaseMgt.CreateSchedule(ContractNo);

        Termination.TerminateLease(ContractNo, 20270415D);

        Line.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(4, Line.Count(), 'Four lines are left');
        Contract.Get(ContractNo);
        Assert.AreEqual(4, Contract.Months, 'Months is the number of lines left');
        Line.FindSet();
        repeat
            Assert.AreEqual(104, Line.Amount, 'Every line gets the four-month rate');
        until Line.Next() = 0;
    end;
}
