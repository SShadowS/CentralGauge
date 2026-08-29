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
        WalletCount: Integer;
        TotalUsage: Decimal;
        ShareAmount: Decimal;
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

        for i := 1 to WalletCount do begin
            ShareAmount := Round(PoolAmount * Usage[i] / TotalUsage, 0.01);

            SettlementLine.Init();
            SettlementLine."Period Code" := PeriodCode;
            SettlementLine."Wallet No." := WalletNo[i];
            SettlementLine.Usage := Usage[i];
            SettlementLine."Cost Share" := ShareAmount;
            SettlementLine.Insert();

            if ShareAmount > 0 then
                WalletMgt.PostCharge(WalletNo[i], ShareAmount);
        end;
    end;
}
