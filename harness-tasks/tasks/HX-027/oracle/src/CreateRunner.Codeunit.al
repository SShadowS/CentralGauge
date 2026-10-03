codeunit 86002 "HX027 Create Runner"
{
    TableNo = "CGR Lease Schedule Line";

    trigger OnRun()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        LeaseMgt.CreateSchedule(Rec."Contract No.");
    end;
}
