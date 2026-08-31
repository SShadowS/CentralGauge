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
        Amount: Decimal;
    begin
        ClearLastError();
        exit(DoImportLine(EntryCode, AmountText, Amount));
    end;

    [TryFunction]
    local procedure DoParseAmount(AmountText: Text; var Amount: Decimal)
    begin
        Amount := ParseAmount(AmountText);
    end;

    [TryFunction]
    local procedure DoImportLine(EntryCode: Code[20]; AmountText: Text; var Amount: Decimal)
    var
        LegacyAmount: Record "CG X076 Legacy Amount";
    begin
        Amount := ParseAmount(AmountText);
        LegacyAmount."Entry Code" := EntryCode;
        LegacyAmount.Amount := Amount;
        LegacyAmount.Insert(true);
    end;
}
