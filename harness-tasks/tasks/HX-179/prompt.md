# Bug 5179: The lease VAT check lets lowered VAT through

Reported by Accounting.

Before the lease invoice journal is posted, `CGR Lease VAT Diff. Check`.`ListExcessVATDifferences` (Leasing) lists the lines of a journal batch whose VAT difference, the amount by which someone changed the VAT the journal calculated, is more than the maximum allowed. Accounting corrects the listed lines before it posts the batch.

Observed: a line whose VAT was lowered by 0.50 is not listed, although the maximum allowed is 0.10. A line whose VAT was raised by 0.50 is listed.

Expected: the procedure returns the line numbers of exactly the lines whose VAT difference, raised or lowered, is more than the maximum allowed for that line; a difference equal to the maximum is allowed. Leases for customers abroad are journalled in the customer's currency, and every line is held to the same maximum the journal itself applies to that line when its VAT amount is entered.

Keep the signature of ListExcessVATDifferences.

Shipped code:

```al
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
                if GenJnlLine."VAT Difference" > GLSetup."Max. VAT Difference Allowed" then
                    LineNos.Add(GenJnlLine."Line No.");
            until GenJnlLine.Next() = 0;
    end;
}
```

Write the corrected AL for the affected procedures and explain briefly.
