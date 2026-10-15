codeunit 86922 "HX073 Handled Lines"
{
    EventSubscriberInstance = Manual;

    var
        LinesHandled: Boolean;

    procedure HX73SetHandled(NewLinesHandled: Boolean)
    begin
        LinesHandled := NewLinesHandled;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnBeforeCreateInvoiceLine', '', false, false)]
    local procedure HX73HandleLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line"; var IsHandled: Boolean)
    begin
        IsHandled := LinesHandled;
    end;
}
