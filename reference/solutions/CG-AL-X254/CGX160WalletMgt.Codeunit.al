codeunit 71443 "CG X160 Wallet Mgt"
{
    /// Charges a wallet for the given amount, refusing when the wallet cannot cover it.
    procedure PostCharge(WalletNo: Code[20]; Amount: Decimal)
    var
        Wallet: Record "CG X160 Wallet";
    begin
        if Amount <= 0 then
            Error(InvalidAmountErr, Amount);
        if not Wallet.Get(WalletNo) then
            Error(MissingWalletErr, WalletNo);
        if Amount > Wallet.Balance then
            Error(InsufficientBalanceErr, WalletNo);

        WriteEntry(WalletNo, "CG X160 Entry Type"::Charge, Amount);

        Wallet.Balance -= Amount;
        Wallet."Total Charged" += Amount;
        Wallet.Modify();
    end;

    /// Puts previously charged money back onto a wallet.
    procedure PostRefund(WalletNo: Code[20]; Amount: Decimal)
    var
        Wallet: Record "CG X160 Wallet";
    begin
        if Amount <= 0 then
            Error(InvalidAmountErr, Amount);
        if not Wallet.Get(WalletNo) then
            Error(MissingWalletErr, WalletNo);
        if Amount > RefundableFor(WalletNo, Wallet."Total Charged") then
            Error(OverRefundErr, WalletNo);

        WriteEntry(WalletNo, "CG X160 Entry Type"::Refund, Amount);

        Wallet.Balance += Amount;
        Wallet.Modify();
    end;

    local procedure RefundableFor(WalletNo: Code[20]; TotalCharged: Decimal): Decimal
    var
        WalletEntry: Record "CG X160 Wallet Entry";
    begin
        WalletEntry.SetRange("Wallet No.", WalletNo);
        WalletEntry.SetRange("Entry Type", "CG X160 Entry Type"::Refund);
        WalletEntry.CalcSums(Amount);
        exit(TotalCharged - WalletEntry.Amount);
    end;

    local procedure WriteEntry(WalletNo: Code[20]; EntryType: Enum "CG X160 Entry Type"; Amount: Decimal)
    var
        WalletEntry: Record "CG X160 Wallet Entry";
    begin
        WalletEntry.Init();
        WalletEntry."Entry No." := NextEntryNo();
        WalletEntry."Wallet No." := WalletNo;
        WalletEntry."Entry Type" := EntryType;
        WalletEntry.Amount := Amount;
        WalletEntry.Insert();
    end;

    local procedure NextEntryNo(): Integer
    var
        WalletEntry: Record "CG X160 Wallet Entry";
    begin
        if WalletEntry.FindLast() then
            exit(WalletEntry."Entry No." + 1);
        exit(1);
    end;

    var
        InvalidAmountErr: Label 'The amount %1 is not a valid amount to post.', Comment = '%1 = amount';
        MissingWalletErr: Label 'Wallet %1 does not exist.', Comment = '%1 = wallet number';
        InsufficientBalanceErr: Label 'Wallet %1 does not have enough balance for this charge.', Comment = '%1 = wallet number';
        OverRefundErr: Label 'Wallet %1 cannot be refunded more than has been charged to it.', Comment = '%1 = wallet number';
}
