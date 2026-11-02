codeunit 87281 "HX091 Delivery Spy"
{
    EventSubscriberInstance = Manual;

    // Counts deliveries that went through (the event passed), like the mail server and the
    // partner share would: these counters are not rolled back with a failed attempt.
    var
        Mails: Dictionary of [Code[20], Integer];
        Exports: Dictionary of [Code[20], Integer];
        MailFails: Dictionary of [Code[20], Integer];
        ExportFails: Dictionary of [Code[20], Integer];
        AfterFails: Dictionary of [Code[20], Integer];
        ProbeContract: Code[20];
        ProbeSeen: Boolean;
        ProbeFound: Boolean;
        ProbeError: Boolean;
        ProbeRetry: Integer;
        MailErr: Label 'HX091 mail server refused %1.', Comment = '%1 = contract number';
        ExportErr: Label 'HX091 partner share unreachable for %1.', Comment = '%1 = contract number';
        AfterErr: Label 'HX091 after-delivery step failed for %1.', Comment = '%1 = contract number';

    procedure HX091FailMail(ContractNo: Code[20]; Times: Integer)
    begin
        MailFails.Set(ContractNo, Times);
    end;

    procedure HX091FailExport(ContractNo: Code[20]; Times: Integer)
    begin
        ExportFails.Set(ContractNo, Times);
    end;

    procedure HX091FailAfter(ContractNo: Code[20]; Times: Integer)
    begin
        AfterFails.Set(ContractNo, Times);
    end;

    procedure HX091Probe(ContractNo: Code[20])
    begin
        ProbeContract := ContractNo;
    end;

    procedure HX091Mails(ContractNo: Code[20]): Integer
    begin
        exit(HX091Count(Mails, ContractNo));
    end;

    procedure HX091Exports(ContractNo: Code[20]): Integer
    begin
        exit(HX091Count(Exports, ContractNo));
    end;

    procedure HX091ProbeSeen(): Boolean
    begin
        exit(ProbeSeen);
    end;

    procedure HX091ProbeFound(): Boolean
    begin
        exit(ProbeFound);
    end;

    procedure HX091ProbeError(): Boolean
    begin
        exit(ProbeError);
    end;

    procedure HX091ProbeRetry(): Integer
    begin
        exit(ProbeRetry);
    end;

    procedure HX091ExportErrText(ContractNo: Code[20]): Text
    begin
        exit(StrSubstNo(ExportErr, ContractNo));
    end;

    procedure HX091AfterErrText(ContractNo: Code[20]): Text
    begin
        exit(StrSubstNo(AfterErr, ContractNo));
    end;

    procedure HX091MailErrText(ContractNo: Code[20]): Text
    begin
        exit(StrSubstNo(MailErr, ContractNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Invoice Delivery", 'OnBeforeSendInvoiceMail', '', false, false)]
    local procedure HX091OnMail(ContractNo: Code[20])
    begin
        HX091Look(ContractNo, true);
        if HX091Take(MailFails, ContractNo) then
            Error(MailErr, ContractNo);
        HX091Bump(Mails, ContractNo);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Invoice Delivery", 'OnBeforeExportInvoice', '', false, false)]
    local procedure HX091OnExport(ContractNo: Code[20])
    begin
        HX091Look(ContractNo, false);
        if HX091Take(ExportFails, ContractNo) then
            Error(ExportErr, ContractNo);
        HX091Bump(Exports, ContractNo);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Invoice Dispatch Run", 'OnAfterDeliverInvoice', '', false, false)]
    local procedure HX091OnAfter(ContractNo: Code[20])
    begin
        HX091Look(ContractNo, false);
        if HX091Take(AfterFails, ContractNo) then
            Error(AfterErr, ContractNo);
    end;

    // The probed entry is read at every delivery step of the probed contract: it must be in the
    // queue while its mail is sent, and never show Error or a retry before anything has failed.
    local procedure HX091Look(ContractNo: Code[20]; AtMail: Boolean)
    var
        Entry: Record "CGR Invoice Dispatch Entry";
    begin
        if (ProbeContract = '') or (ContractNo <> ProbeContract) then
            exit;
        Entry.SetRange("Contract No.", ContractNo);
        if not Entry.FindFirst() then begin
            if AtMail then
                ProbeSeen := true;
            exit;
        end;
        if AtMail and not ProbeSeen then begin
            ProbeSeen := true;
            ProbeFound := true;
        end;
        if Entry.Error then
            ProbeError := true;
        if Entry."Retry Count" > ProbeRetry then
            ProbeRetry := Entry."Retry Count";
    end;

    local procedure HX091Count(var Counter: Dictionary of [Code[20], Integer]; ContractNo: Code[20]): Integer
    begin
        if Counter.ContainsKey(ContractNo) then
            exit(Counter.Get(ContractNo));
        exit(0);
    end;

    local procedure HX091Bump(var Counter: Dictionary of [Code[20], Integer]; ContractNo: Code[20])
    begin
        Counter.Set(ContractNo, HX091Count(Counter, ContractNo) + 1);
    end;

    local procedure HX091Take(var Fails: Dictionary of [Code[20], Integer]; ContractNo: Code[20]): Boolean
    var
        Left: Integer;
    begin
        Left := HX091Count(Fails, ContractNo);
        if Left <= 0 then
            exit(false);
        Fails.Set(ContractNo, Left - 1);
        exit(true);
    end;
}
