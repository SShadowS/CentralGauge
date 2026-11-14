codeunit 70360 "CGR Lease VAT Diff. Check"
{
    procedure ListExcessVATDifferences(TemplateName: Code[10]; BatchName: Code[10]) LineNos: List of [Integer]
    var
        GenJnlLine: Record "Gen. Journal Line";
    begin
        GenJnlLine.SetRange("Journal Template Name", TemplateName);
        GenJnlLine.SetRange("Journal Batch Name", BatchName);
        GenJnlLine.SetFilter("VAT Difference", '<>0');
        if GenJnlLine.FindSet() then
            repeat
                if Abs(GenJnlLine."VAT Difference") > MaxVATDifference(GenJnlLine."Currency Code") then
                    LineNos.Add(GenJnlLine."Line No.");
            until GenJnlLine.Next() = 0;
    end;

    local procedure MaxVATDifference(CurrencyCode: Code[10]): Decimal
    var
        Currency: Record Currency;
        GLSetup: Record "General Ledger Setup";
    begin
        if CurrencyCode = '' then begin
            GLSetup.Get();
            exit(GLSetup."Max. VAT Difference Allowed");
        end;
        Currency.Get(CurrencyCode);
        exit(Currency."Max. VAT Difference Allowed");
    end;
}
