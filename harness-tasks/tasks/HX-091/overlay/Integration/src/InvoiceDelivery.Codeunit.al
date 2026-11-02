codeunit 70433 "CGR Invoice Delivery"
{
    procedure SendInvoiceMail(ContractNo: Code[20])
    var
        MailLog: Record "CGR Invoice Mail Log";
    begin
        OnBeforeSendInvoiceMail(ContractNo);
        MailLog.Init();
        MailLog."Contract No." := ContractNo;
        MailLog."Sent At" := CurrentDateTime();
        MailLog.Insert();
    end;

    procedure ExportInvoice(ContractNo: Code[20])
    var
        ExportLog: Record "CGR Invoice Export Log";
    begin
        OnBeforeExportInvoice(ContractNo);
        ExportLog.Init();
        ExportLog."Contract No." := ContractNo;
        ExportLog."Exported At" := CurrentDateTime();
        ExportLog.Insert();
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeSendInvoiceMail(ContractNo: Code[20])
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeExportInvoice(ContractNo: Code[20])
    begin
    end;
}
