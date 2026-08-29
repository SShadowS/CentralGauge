codeunit 71582 "CG X174 Settlement Mgt"
{
    /// <summary>
    /// Settles a billing period: aggregates each wallet's usage from the
    /// currently collected meter readings (mapped through the owner map),
    /// spreads the period's cost pool across the owning wallets in
    /// proportion to their usage, records one settlement line per wallet,
    /// and charges each wallet its computed share. A wallet with no usage
    /// in the period receives a Cost Share of zero and is not charged.
    /// Resettling the same period replaces its settlement lines rather
    /// than duplicating them. A collected reading whose meter is not in
    /// the owner map contributes nothing to the settlement.
    /// </summary>
    procedure SettlePeriod(PeriodCode: Code[20]; PoolAmount: Decimal)
    var
        CollectedReading: Record "CG X162 Collected Reading";
        OwnerMap: Record "CG X174 Owner Map";
        SettlementLine: Record "CG X174 Settlement Line";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
        WalletNo: array[12] of Code[20];
        Usage: array[12] of Decimal;
        FloorShare: array[12] of Decimal;
        Remainder: array[12] of Decimal;
        Awarded: array[12] of Boolean;
        WalletCount: Integer;
        TotalUsage: Decimal;
        FloorSum: Decimal;
        RemainingResidual: Decimal;
        ExactShare: Decimal;
        WinnerIndex: Integer;
        MappedWallet: Code[20];
        AlreadySeen: Boolean;
        i: Integer;
    begin
        SettlementLine.SetRange("Period Code", PeriodCode);
        SettlementLine.DeleteAll();

        WalletCount := 0;
        TotalUsage := 0;
        if CollectedReading.FindSet() then
            repeat
                if OwnerMap.Get(CollectedReading."Meter No.") then begin
                    MappedWallet := OwnerMap."Wallet No.";
                    AlreadySeen := false;
                    for i := 1 to WalletCount do
                        if WalletNo[i] = MappedWallet then begin
                            Usage[i] += CollectedReading.Quantity;
                            AlreadySeen := true;
                        end;
                    if not AlreadySeen then begin
                        WalletCount += 1;
                        WalletNo[WalletCount] := MappedWallet;
                        Usage[WalletCount] := CollectedReading.Quantity;
                    end;
                    TotalUsage += CollectedReading.Quantity;
                end;
            until CollectedReading.Next() = 0;

        if TotalUsage = 0 then
            exit;

        // First pass: every wallet gets the floor of its exact proportional
        // share. A wallet with zero usage always floors to zero and never
        // earns a remainder, so it can never end up with anything else
        // below.
        FloorSum := 0;
        for i := 1 to WalletCount do begin
            Awarded[i] := false;
            if Usage[i] = 0 then begin
                FloorShare[i] := 0;
                Remainder[i] := 0;
            end else begin
                ExactShare := PoolAmount * Usage[i] / TotalUsage;
                FloorShare[i] := Round(ExactShare, 0.01, '<');
                Remainder[i] := ExactShare - FloorShare[i];
                FloorSum += FloorShare[i];
            end;
        end;

        // Second pass: whatever the floors left on the table is handed out
        // one cent at a time to the wallets closest to rounding up, so the
        // recorded shares always add up to exactly the period's pool.
        RemainingResidual := PoolAmount - FloorSum;
        while RemainingResidual >= 0.005 do begin
            WinnerIndex := 0;
            for i := 1 to WalletCount do
                if (Usage[i] <> 0) and (not Awarded[i]) then
                    // AL's "or" does not short-circuit, so a single
                    // condition with "WinnerIndex = 0 or Remainder[i] >
                    // Remainder[WinnerIndex]" still evaluates
                    // Remainder[WinnerIndex] on the very first candidate,
                    // indexing Remainder[0] - guard it with a nested if
                    // instead.
                    if WinnerIndex = 0 then
                        WinnerIndex := i
                    else
                        if (Remainder[i] > Remainder[WinnerIndex]) or
                           ((Remainder[i] = Remainder[WinnerIndex]) and (i < WinnerIndex))
                        then
                            WinnerIndex := i;
            FloorShare[WinnerIndex] += 0.01;
            Awarded[WinnerIndex] := true;
            RemainingResidual -= 0.01;
        end;

        for i := 1 to WalletCount do begin
            SettlementLine.Init();
            SettlementLine."Period Code" := PeriodCode;
            SettlementLine."Wallet No." := WalletNo[i];
            SettlementLine.Usage := Usage[i];
            SettlementLine."Cost Share" := FloorShare[i];
            SettlementLine.Insert();

            if FloorShare[i] > 0 then
                WalletMgt.PostCharge(WalletNo[i], FloorShare[i]);
        end;
    end;
}
