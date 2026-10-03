codeunit 80075 "CGR Lease Invoice Naive Spy"
{
    EventSubscriberInstance = Manual;

    var
        AfterFound: Integer;

    procedure ArchivedLineCount(): Integer
    begin
        exit(AfterFound);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnAfterCreateInvoiceLine', '', false, false)]
    local procedure ArchiveInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line")
    var
        StoredLine: Record "CGR Lease Invoice Line";
    begin
        if StoredLine.Get(InvoiceLine."Contract No.", InvoiceLine."Schedule Line No.") then
            AfterFound += 1;
    end;
}
