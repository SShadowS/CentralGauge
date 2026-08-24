codeunit 70590 "CG X094 Reference Engine"
{
    procedure ResolveReference(Category: Code[20]; SourceNo: Code[20]; PeriodNo: Integer): Text[50]
    var
        Result: Text[50];
        IsHandled: Boolean;
    begin
        OnBeforeResolveReference(Category, SourceNo, PeriodNo, Result, IsHandled);
        if not IsHandled then
            Result := DefaultTemplate(Category, SourceNo);
        Result := AppendFiscalSegment(Result, PeriodNo);
        exit(Result);
    end;

    procedure FiscalSegmentFor(PeriodNo: Integer): Code[10]
    var
        YearOffset: Integer;
        Digits: Text[2];
    begin
        YearOffset := PeriodNo mod 100;
        if YearOffset < 0 then
            YearOffset += 100;
        Digits := Format(YearOffset);
        if StrLen(Digits) = 1 then
            Digits := '0' + Digits;
        exit('FY' + Digits);
    end;

    local procedure DefaultTemplate(Category: Code[20]; SourceNo: Code[20]): Text[50]
    begin
        exit(Category + '-' + SourceNo);
    end;

    local procedure AppendFiscalSegment(Base: Text[50]; PeriodNo: Integer): Text[50]
    begin
        exit(Base + '/' + FiscalSegmentFor(PeriodNo));
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeResolveReference(Category: Code[20]; SourceNo: Code[20]; PeriodNo: Integer; var Result: Text[50]; var IsHandled: Boolean)
    begin
    end;
}
