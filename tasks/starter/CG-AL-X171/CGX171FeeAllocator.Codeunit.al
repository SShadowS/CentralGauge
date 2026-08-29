codeunit 71550 "CG X171 Fee Allocator"
{
    /// <summary>
    /// Calculates a handling fee on an invoice: the invoice's Total
    /// Handling Fee is its Handling Fee Pct applied to the sum of its
    /// lines' own Net Amount, and each line's own Handling Fee is that
    /// line's share of the Total Handling Fee in proportion to its own
    /// Net Amount. A line with a Net Amount of zero always receives a
    /// Handling Fee of exactly zero.
    /// </summary>
    procedure CalculateFees(DocumentNo: Code[20])
    var
        FeeInvoice: Record "CG X171 Fee Invoice";
        FeeInvoiceLine: Record "CG X171 Fee Invoice Line";
        NetTotal: Decimal;
        RunningTotal: Decimal;
        LineFee: Decimal;
    begin
        FeeInvoice.Get(DocumentNo);

        FeeInvoiceLine.SetRange("Document No.", DocumentNo);
        NetTotal := 0;
        if FeeInvoiceLine.FindSet() then
            repeat
                NetTotal += FeeInvoiceLine."Net Amount";
            until FeeInvoiceLine.Next() = 0;

        if NetTotal = 0 then
            exit;

        RunningTotal := 0;
        if FeeInvoiceLine.FindSet() then
            repeat
                LineFee := Round(FeeInvoiceLine."Net Amount" * FeeInvoice."Handling Fee Pct" / 100, 0.01);
                FeeInvoiceLine."Handling Fee" := LineFee;
                RunningTotal += LineFee;
                FeeInvoiceLine.Modify();
            until FeeInvoiceLine.Next() = 0;

        FeeInvoice."Total Handling Fee" := RunningTotal;
        FeeInvoice."Fees Calculated" := true;
        FeeInvoice.Modify();
    end;

    /// <summary>
    /// Returns the sum of the handling fees already recorded on an
    /// invoice's lines, for reconciliation against the invoice's own
    /// Total Handling Fee.
    /// </summary>
    procedure GetCalculatedFeeTotal(DocumentNo: Code[20]): Decimal
    var
        FeeInvoiceLine: Record "CG X171 Fee Invoice Line";
    begin
        FeeInvoiceLine.SetRange("Document No.", DocumentNo);
        FeeInvoiceLine.CalcSums("Handling Fee");
        exit(FeeInvoiceLine."Handling Fee");
    end;
}
