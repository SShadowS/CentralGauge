codeunit 71550 "CG X171 Fee Allocator"
{
    /// <summary>
    /// Calculates a handling fee on an invoice: the invoice's Total
    /// Handling Fee is its Handling Fee Pct applied to the sum of its
    /// lines' own Net Amount, rounded to the nearest cent. Each line's
    /// own Handling Fee is then that line's share of the Total Handling
    /// Fee in proportion to its own Net Amount, rounded down to the
    /// cent; whenever the shares do not divide evenly, the leftover
    /// cents go one at a time to whichever line's exact entitlement was
    /// rounded down by the largest amount. A line with a Net Amount of
    /// zero always receives a Handling Fee of exactly zero.
    /// </summary>
    procedure CalculateFees(DocumentNo: Code[20])
    var
        FeeInvoice: Record "CG X171 Fee Invoice";
        FeeInvoiceLine: Record "CG X171 Fee Invoice Line";
        NetTotal: Decimal;
        DocumentFee: Decimal;
        ExactShare: Decimal;
        FloorShare: Decimal;
        FloorSum: Decimal;
        RemainingResidual: Decimal;
        RemainderMap: Dictionary of [Integer, Decimal];
        AwardedMap: Dictionary of [Integer, Boolean];
        BestLineNo: Integer;
        BestRemainder: Decimal;
        HasBest: Boolean;
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

        DocumentFee := Round(NetTotal * FeeInvoice."Handling Fee Pct" / 100, 0.01);

        FloorSum := 0;
        if FeeInvoiceLine.FindSet() then
            repeat
                AwardedMap.Add(FeeInvoiceLine."Line No.", false);
                if FeeInvoiceLine."Net Amount" = 0 then begin
                    FeeInvoiceLine."Handling Fee" := 0;
                    RemainderMap.Add(FeeInvoiceLine."Line No.", 0);
                end else begin
                    ExactShare := DocumentFee * FeeInvoiceLine."Net Amount" / NetTotal;
                    FloorShare := Round(ExactShare, 0.01, '<');
                    FeeInvoiceLine."Handling Fee" := FloorShare;
                    FloorSum += FloorShare;
                    RemainderMap.Add(FeeInvoiceLine."Line No.", ExactShare - FloorShare);
                end;
                FeeInvoiceLine.Modify();
            until FeeInvoiceLine.Next() = 0;

        // Whatever the floors left on the table gets handed out one cent at
        // a time to the line closest to rounding up, tie-broken by the
        // lower line number - re-scanning every pass since a line, once
        // awarded, must never be picked again. A zero-amount line's
        // remainder is always exactly zero, so it never competes.
        RemainingResidual := DocumentFee - FloorSum;
        while RemainingResidual >= 0.005 do begin
            HasBest := false;
            BestLineNo := 0;
            BestRemainder := 0;
            FeeInvoiceLine.SetRange("Document No.", DocumentNo);
            if FeeInvoiceLine.FindSet() then
                repeat
                    if (FeeInvoiceLine."Net Amount" <> 0) and (not AwardedMap.Get(FeeInvoiceLine."Line No.")) then
                        if not HasBest then begin
                            BestLineNo := FeeInvoiceLine."Line No.";
                            BestRemainder := RemainderMap.Get(FeeInvoiceLine."Line No.");
                            HasBest := true;
                        end else
                            if RemainderMap.Get(FeeInvoiceLine."Line No.") > BestRemainder then begin
                                BestLineNo := FeeInvoiceLine."Line No.";
                                BestRemainder := RemainderMap.Get(FeeInvoiceLine."Line No.");
                            end;
                until FeeInvoiceLine.Next() = 0;

            if HasBest then begin
                FeeInvoiceLine.Get(DocumentNo, BestLineNo);
                FeeInvoiceLine."Handling Fee" += 0.01;
                FeeInvoiceLine.Modify();
                AwardedMap.Set(BestLineNo, true);
            end;
            RemainingResidual -= 0.01;
        end;

        FeeInvoice."Total Handling Fee" := DocumentFee;
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
