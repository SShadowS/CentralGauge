codeunit 80101 "CGR Lease Schedule Naive Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure DueDatesFollowStartDate()
    var
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
        Expected: array[12] of Date;
        i: Integer;
    begin
        ContractNo := Lib.CreateLease('T-LEASE-001', 20270131D, 12, 10.07);
        LeaseMgt.CreateSchedule(ContractNo);
        Expected[1] := 20270131D;
        Expected[2] := 20270228D;
        Expected[3] := 20270331D;
        Expected[4] := 20270430D;
        Expected[5] := 20270531D;
        Expected[6] := 20270630D;
        Expected[7] := 20270731D;
        Expected[8] := 20270831D;
        Expected[9] := 20270930D;
        Expected[10] := 20271031D;
        Expected[11] := 20271130D;
        Expected[12] := 20271231D;
        for i := 1 to 12 do begin
            Line.Get(ContractNo, i * 10000);
            Assert.AreEqual(Expected[i], Line."Due Date", StrSubstNo('Due date of installment %1', i));
        end;
    end;
}
