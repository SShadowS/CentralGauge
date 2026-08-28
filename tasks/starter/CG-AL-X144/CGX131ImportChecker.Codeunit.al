codeunit 70911 "CG X131 Import Checker"
{
    var
        ItemNoMissingErr: Label 'Line %1: Item No. is missing.', Comment = '%1 = Line No.';
        QuantityNotPositiveErr: Label 'Line %1: Quantity must be greater than zero.', Comment = '%1 = Line No.';
        UnitCostNegativeErr: Label 'Line %1: Unit Cost cannot be negative.', Comment = '%1 = Line No.';

    [ErrorBehavior(ErrorBehavior::Collect)]
    procedure CheckLine(ImportLine: Record "CG X131 Import Line"; var LineMessages: List of [Text])
    var
        CollectedError: ErrorInfo;
    begin
        Clear(LineMessages);

        if ImportLine."Item No." = '' then
            Error(ErrorInfo.Create(StrSubstNo(ItemNoMissingErr, ImportLine."Line No."), true));

        if ImportLine.Quantity <= 0 then
            Error(ErrorInfo.Create(StrSubstNo(QuantityNotPositiveErr, ImportLine."Line No."), true));

        if ImportLine."Unit Cost" < 0 then
            Error(ErrorInfo.Create(StrSubstNo(UnitCostNegativeErr, ImportLine."Line No."), true));

        foreach CollectedError in GetCollectedErrors(true) do
            LineMessages.Add(CollectedError.Message);
    end;

    procedure CheckBatch(BatchCode: Code[20]; var Problems: List of [Text])
    var
        ImportLine: Record "CG X131 Import Line";
        LineMessages: List of [Text];
        Msg: Text;
    begin
        Clear(Problems);

        ImportLine.SetRange("Batch Code", BatchCode);
        if ImportLine.FindSet() then
            repeat
                CheckLine(ImportLine, LineMessages);
                foreach Msg in LineMessages do
                    Problems.Add(Msg);
            until ImportLine.Next() = 0;
    end;
}
