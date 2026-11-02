codeunit 87383 "HX096 Validate To Be Paid"
{
    TableNo = "CGR Payout Line";

    // Validates only, never saves: a refusal must come from the field itself.
    trigger OnRun()
    begin
        Rec.Validate("To Be Paid", true);
    end;
}
