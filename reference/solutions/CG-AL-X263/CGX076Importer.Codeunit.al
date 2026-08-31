codeunit 70411 "CG X076 Legacy Importer"
{
    var
        InvalidAmountErr: Label '''%1'' is not a valid amount.', Comment = '%1 = the text that could not be converted';

    procedure ParseAmount(AmountText: Text): Decimal
    var
        Amount: Decimal;
    begin
        if not Evaluate(Amount, AmountText) then
            Error(InvalidAmountErr, AmountText);
        if Amount < 0 then
            Error(InvalidAmountErr, AmountText);
        exit(Amount);
    end;

    procedure TryParseAmount(AmountText: Text; var Amount: Decimal; var FailureReason: Text): Boolean
    begin
        ClearLastError();
        if DoParseAmount(AmountText, Amount) then begin
            FailureReason := '';
            exit(true);
        end;
        FailureReason := GetLastErrorText();
        exit(false);
    end;

    procedure ImportLine(EntryCode: Code[20]; AmountText: Text): Boolean
    var
        LegacyAmount: Record "CG X076 Legacy Amount";
        Amount: Decimal;
        FailureReason: Text;
    begin
        if not TryParseAmount(AmountText, Amount, FailureReason) then
            exit(false);
        LegacyAmount."Entry Code" := EntryCode;
        LegacyAmount.Amount := Amount;
        LegacyAmount.Insert(true);
        exit(true);
    end;

    [TryFunction]
    local procedure DoParseAmount(AmountText: Text; var Amount: Decimal)
    begin
        Amount := ParseAmount(AmountText);
    end;
}
