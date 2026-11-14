codeunit 70360 "CGR Lease VAT Diff. Check"
{
    procedure ListExcessVATDifferences(TemplateName: Code[10]; BatchName: Code[10]) LineNos: List of [Integer]
    var
        GenJnlLine: Record "Gen. Journal Line";
        GLSetup: Record "General Ledger Setup";
    begin
        GLSetup.Get();
        GenJnlLine.SetRange("Journal Template Name", TemplateName);
        GenJnlLine.SetRange("Journal Batch Name", BatchName);
        GenJnlLine.SetFilter("VAT Difference", '<>0');
        if GenJnlLine.FindSet() then
            repeat
                if Abs(GenJnlLine."VAT Difference") > GLSetup."Max. VAT Difference Allowed" then
                    LineNos.Add(GenJnlLine."Line No.");
            until GenJnlLine.Next() = 0;
    end;
}
