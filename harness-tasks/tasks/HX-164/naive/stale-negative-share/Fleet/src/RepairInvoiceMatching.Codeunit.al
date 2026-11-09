codeunit 70190 "CGR Repair Invoice Matching"
{
    var
        DifferenceTooLargeErr: Label 'The workshop total differs from the calculated total by %1, which is more than the allowed %2.', Comment = '%1 = difference, %2 = maximum';

    procedure MatchToWorkshopTotal(var PurchHeader: Record "Purchase Header"; WorkshopTotalInclVAT: Decimal)
    var
        PurchLine: Record "Purchase Line";
        TempVATAmountLine: Record "VAT Amount Line" temporary;
        Currency: Record Currency;
        Difference: Decimal;
        TotalBase: Decimal;
        Exact: Decimal;
        Share: Decimal;
        Carry: Decimal;
    begin
        Currency.Initialize(PurchHeader."Currency Code");
        PurchLine.SetRange("Document Type", PurchHeader."Document Type");
        PurchLine.SetRange("Document No.", PurchHeader."No.");
        PurchLine.CalcVATAmountLines(0, PurchHeader, PurchLine, TempVATAmountLine);

        TempVATAmountLine.CalcSums("Amount Including VAT");
        Difference := WorkshopTotalInclVAT - TempVATAmountLine."Amount Including VAT";
        if Difference = 0 then
            exit;
        CheckDifferenceAllowed(Difference);

        if TempVATAmountLine.FindSet() then
            repeat
                TotalBase += Abs(TempVATAmountLine."VAT Base");
            until TempVATAmountLine.Next() = 0;

        if TempVATAmountLine.FindSet() then
            repeat
                Exact := Difference * Abs(TempVATAmountLine."VAT Base") / TotalBase + Carry;
                Share := Round(Exact, Currency."Amount Rounding Precision");
                Carry := Exact - Share;
                if TempVATAmountLine.Positive then
                    TempVATAmountLine.Validate("VAT Amount", TempVATAmountLine."VAT Amount" + Share)
                else
                    TempVATAmountLine."VAT Amount" := TempVATAmountLine."VAT Amount" + Share;
                TempVATAmountLine."Amount Including VAT" := TempVATAmountLine."VAT Base" + TempVATAmountLine."VAT Amount";
                TempVATAmountLine."VAT Difference" := TempVATAmountLine."VAT Amount" - TempVATAmountLine."Calculated VAT Amount";
                TempVATAmountLine.Modified := true;
                TempVATAmountLine.Modify();
            until TempVATAmountLine.Next() = 0;

        PurchLine.UpdateVATOnLines(0, PurchHeader, PurchLine, TempVATAmountLine);
    end;

    local procedure CheckDifferenceAllowed(Difference: Decimal)
    var
        Setup: Record "CGR Setup";
    begin
        Setup.GetOrCreate();
        if Abs(Difference) > Setup."Max. Workshop VAT Diff." then
            Error(DifferenceTooLargeErr, Difference, Setup."Max. Workshop VAT Diff.");
    end;
}
