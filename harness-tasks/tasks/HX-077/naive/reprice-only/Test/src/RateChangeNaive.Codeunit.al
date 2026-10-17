codeunit 80127 "CGR Rate Change Naive"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure ChangeRepricesScheduleLines()
    var
        Contract: Record "CGR Lease Contract";
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        RateChange: Codeunit "CGR Lease Rate Change";
        ContractNo: Code[20];
    begin
        WorkDate(20270115D);
        Lib.SetV2Setup(0.01, '', 3);
        ContractNo := Lib.CreateLease('HX077-N01', 20270115D, 6, 100);
        LeaseMgt.CreateSchedule(ContractNo);

        RateChange.ChangeBaseRate(ContractNo, 150);

        Contract.Get(ContractNo);
        Assert.AreEqual(150, Contract."Base Rate", 'The lease gets the new base rate');
        Line.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(6, Line.Count(), 'Six schedule lines');
        Line.FindSet();
        repeat
            Assert.AreEqual(159, Line.Amount, 'Every line gets the six-month rate of 150');
        until Line.Next() = 0;
    end;
}
