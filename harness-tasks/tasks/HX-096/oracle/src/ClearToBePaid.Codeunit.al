codeunit 87382 "HX096 Clear To Be Paid"
{
    TableNo = "CGR Payout Line";

    trigger OnRun()
    begin
        Rec.Validate("To Be Paid", false);
        Rec.Modify();
    end;
}
