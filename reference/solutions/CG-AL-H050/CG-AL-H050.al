codeunit 70500 "CG H050 Validator"
{
    Access = Public;

    [ErrorBehavior(ErrorBehavior::Collect)]
    procedure ValidateAll(var Email: Record "CG H050 Email") InvalidCount: Integer
    var
        CollectedErrors: List of [ErrorInfo];
    begin
        InvalidCount := 0;

        if Email.FindSet() then
            repeat
                if StrPos(Email."Address", '@') = 0 then
                    Error(ErrorInfo.Create(StrSubstNo('Invalid: %1', Email."Address"), true));
            until Email.Next() = 0;

        if HasCollectedErrors() then begin
            CollectedErrors := GetCollectedErrors(true);
            InvalidCount := CollectedErrors.Count();
        end;
    end;
}