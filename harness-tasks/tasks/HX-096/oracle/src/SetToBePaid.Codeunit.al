codeunit 87381 "HX096 Set To Be Paid"
{
    TableNo = "CGR Payout Line";

    trigger OnRun()
    begin
        Rec.Validate("To Be Paid", true);
        Rec.Modify();
    end;
}
