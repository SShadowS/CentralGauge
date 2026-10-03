codeunit 86001 "HX027 Build Runner"
{
    TableNo = "CGR Lease Schedule Line";

    trigger OnRun()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseNo: Code[20];
    begin
        LeaseNo := Rec."Contract No.";
        LeaseMgt.BuildSchedule(LeaseNo, Rec);
    end;
}
