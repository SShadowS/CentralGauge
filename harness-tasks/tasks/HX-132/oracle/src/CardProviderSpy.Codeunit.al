// The payment app and the key box. Every list lives in memory, outside the write transaction, so it keeps what
// happened inside a check-out or swap that then fails and is rolled back: a release made there stays counted.
codeunit 87941 "HX132 Card Provider Spy"
{
    EventSubscriberInstance = Manual;

    var
        CodePrefix: Text[30];
        IssuedCodes: List of [Text];
        IssuedAmounts: List of [Decimal];
        ReleasedCodes: List of [Text];
        RequestsAtKeyBox: List of [Integer];
        RefuseKeys: Boolean;
        KeyBoxRefusedErr: Label 'HX132 key box refused contract %1.', Comment = '%1 = contract number';

    procedure Init(NewPrefix: Text[30])
    begin
        CodePrefix := NewPrefix;
        Clear(IssuedCodes);
        Clear(IssuedAmounts);
        Clear(ReleasedCodes);
        Clear(RequestsAtKeyBox);
        RefuseKeys := false;
    end;

    procedure SetRefuseKeys(Refuse: Boolean)
    begin
        RefuseKeys := Refuse;
    end;

    procedure RefusalText(ContractNo: Code[20]): Text
    begin
        exit(StrSubstNo(KeyBoxRefusedErr, ContractNo));
    end;

    procedure RequestCount(): Integer
    begin
        exit(IssuedCodes.Count());
    end;

    procedure IssuedCode(Index: Integer): Text
    begin
        exit(IssuedCodes.Get(Index));
    end;

    procedure IssuedAmount(Index: Integer): Decimal
    begin
        exit(IssuedAmounts.Get(Index));
    end;

    procedure ReleaseCount(): Integer
    begin
        exit(ReleasedCodes.Count());
    end;

    procedure ReleasedCode(Index: Integer): Text
    begin
        exit(ReleasedCodes.Get(Index));
    end;

    procedure TimesReleased(AuthCode: Text): Integer
    var
        ReleasedCode: Text;
        Total: Integer;
    begin
        foreach ReleasedCode in ReleasedCodes do
            if ReleasedCode = AuthCode then
                Total += 1;
        exit(Total);
    end;

    procedure KeyBoxCount(): Integer
    begin
        exit(RequestsAtKeyBox.Count());
    end;

    procedure RequestsBeforeKeyBox(Index: Integer): Integer
    begin
        exit(RequestsAtKeyBox.Get(Index));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental Mgt", 'OnRequestPreAuthorization', '', false, false)]
    local procedure IssueHold(Contract: Record "CGR Rental Contract"; Amount: Decimal; var AuthCode: Text[50])
    var
        NewCode: Text;
    begin
        NewCode := CodePrefix + '-' + Format(IssuedCodes.Count() + 1);
        IssuedCodes.Add(NewCode);
        IssuedAmounts.Add(Amount);
        AuthCode := CopyStr(NewCode, 1, MaxStrLen(AuthCode));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental Mgt", 'OnReleasePreAuthorization', '', false, false)]
    local procedure ReleaseHold(AuthCode: Text[50])
    begin
        ReleasedCodes.Add(AuthCode);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental Mgt", 'OnAfterCheckOut', '', false, false)]
    local procedure KeyBoxOnCheckOut(var Contract: Record "CGR Rental Contract")
    begin
        HandOutKeys(Contract."No.");
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental Mgt", 'OnAfterSwapVehicle', '', false, false)]
    local procedure KeyBoxOnSwap(var Contract: Record "CGR Rental Contract")
    begin
        HandOutKeys(Contract."No.");
    end;

    local procedure HandOutKeys(ContractNo: Code[20])
    begin
        RequestsAtKeyBox.Add(IssuedCodes.Count());
        if RefuseKeys then
            Error(KeyBoxRefusedErr, ContractNo);
    end;
}
