codeunit 89191 "CG-AL-X094 Other Rule"
{
    // Oracle-side companion (see NOTES.md). A second, independently bound
    // custom rule that resolves its own body for a category the shipped
    // solution never mentions. It only proves anything if the candidate
    // still resolves references through the same extensible mechanism the
    // shipped solution used - a rewrite that hardcodes the CUSTOM category
    // inline (dropping the event entirely) leaves this rule unreachable.
    EventSubscriberInstance = Manual;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X094 Reference Engine", 'OnBeforeResolveReference', '', true, true)]
    local procedure ResolveOtherReference(Category: Code[20]; SourceNo: Code[20]; PeriodNo: Integer; var Result: Text[50]; var IsHandled: Boolean)
    begin
        if Category <> 'ZOTHER' then
            exit;

        Result := 'ZZZ';
        IsHandled := true;
    end;
}
