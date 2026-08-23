codeunit 70591 "CG X094 Custom Rule"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X094 Reference Engine", 'OnBeforeResolveReference', '', true, true)]
    local procedure ResolveCustomReference(Category: Code[20]; SourceNo: Code[20]; PeriodNo: Integer; var Result: Text[50]; var IsHandled: Boolean)
    begin
        if Category <> 'CUSTOM' then
            exit;

        Result := 'CUST~' + SourceNo;
        IsHandled := true;
    end;
}
