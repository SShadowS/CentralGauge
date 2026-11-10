codeunit 88421 "HX164 Match Runner"
{
    var
        RunDocumentNo: Code[20];
        RunTotal: Decimal;

    procedure SetMatchHX164(DocumentNo: Code[20]; WorkshopTotal: Decimal)
    begin
        RunDocumentNo := DocumentNo;
        RunTotal := WorkshopTotal;
    end;

    trigger OnRun()
    var
        PurchHeader: Record "Purchase Header";
        Matching: Codeunit "CGR Repair Invoice Matching";
    begin
        PurchHeader.Get(PurchHeader."Document Type"::Invoice, RunDocumentNo);
        Matching.MatchToWorkshopTotal(PurchHeader, RunTotal);
    end;
}
